import { close, existsSync, open, readFile, write } from "fs";
import { join } from "path";
import { promisify } from "util";
import { BigNumber, ethers } from "ethers";
import { Log, Provider } from "@ethersproject/abstract-provider";
import { COMMON_TREASURY, ZERO_ADDRESS } from "./constant";
import { ERC20, ERC20TransferArgs, ERC20_ABI_SLIM } from "./erc20";
import { MasterChefV2DepositArgs, MASTER_CHEF_V2 } from "./master-chef-v2";
import { VESOS_ABI_SLIM } from "./vesos";

const OUTPUT_DIR = join(__dirname, "..", "data");
const SOS_ADDRESS = "0x3b484b82567a09e2588a13d54d032153f0c0aee0";
const VESOS_ADDRESS = "0xedd27c961ce6f79afc16fd287d934ee31a90d7d1";
const SLP_ADDRESS = "0xB84C45174Bfc6b8F3EaeCBae11deE63114f5c1b2"
const MASTER_CHEF_V2_ADDRESS = "0xef0881ec094552b2e128cf945ef17a6752b4ec5d";
const SOS_GENESIS_BLOCK = 13860522;
const VESOS_GENESIS_BLOCK = 13938731;
const SLP_GENESIS_BLOCK = 13864933;

async function saveBalance(balances: { [wallet: string]: BigNumber }, endBlock: number, contract: string) {
  const fd = await promisify(open)(join(OUTPUT_DIR, contract + "-" + endBlock + ".json"), "w");

  for (const wallet in balances) {
    let content = [wallet, balances[wallet].toString()].join(",") + "\r\n";
    await promisify(write)(fd, content);
  }

  await promisify(close)(fd);
}

async function loadBalance(endBlock: number, contract: string) {
  const file = join(OUTPUT_DIR, contract + "-" + endBlock + ".json");
  if (!existsSync(file)) {
    return {};
  }

  const content = await promisify(readFile)(file, 'ascii');
  const balances: { [wallet: string]: BigNumber } = {};

  content
    .split('\r\n')
    .filter(line => !!line)
    .forEach(line => {
      const [account, balance] = line.split(',');
      balances[account] = BigNumber.from(balance);
    });

  return balances;
}

async function getERC20Balances(tokenAddress: string, genesisBlock: number, endBlock: number, batchSize: number, provider: Provider) {
  const balancesByAddress: { [wallet: string]: BigNumber } = await loadBalance(endBlock, tokenAddress);

  if (Object.entries(balancesByAddress).length > 0) {
    return balancesByAddress;
  }

  for (let startBlock = genesisBlock; startBlock <= endBlock;) {
    let blocksToGet = Math.min(endBlock - startBlock + 1, batchSize);
    let toBlock = startBlock + blocksToGet - 1;

    let logs = await provider.getLogs({
      fromBlock: startBlock,
      toBlock: toBlock,
      address: tokenAddress,
      topics: [[ERC20.getEventTopic("Transfer")]],
    });

    const logsByBlocks: { [block: number]: Log[] } = {};

    logs.forEach(log => {
      if (!logsByBlocks[log.blockNumber]) logsByBlocks[log.blockNumber] = [];

      logsByBlocks[log.blockNumber].push(log);
    });

    for (let block = startBlock; block <= toBlock; block++) {
      if (!logsByBlocks[block]) continue;

      logsByBlocks[block].sort((a, b) => a.logIndex - b.logIndex);

      for (const log of logsByBlocks[block]) {
        const event = ERC20.parseLog(log);
        const args = event.args as any as ERC20TransferArgs;

        console.log("[%s|%d|%s] Transfer %d from %s to %s",
          tokenAddress,
          log.blockNumber,
          log.logIndex.toString().padStart(3),
          args.value.toString(),
          args.from,
          args.to);

        if (args.value.isZero()) {
          continue;
        }

        if (args.from != ZERO_ADDRESS) {
          balancesByAddress[args.from] = balancesByAddress[args.from].sub(args.value);
        }

        balancesByAddress[args.to] = (balancesByAddress[args.to] ?? BigNumber.from(0)).add(args.value);
      }
    }

    startBlock = toBlock + 1;
  }

  for (const wallet in balancesByAddress) {
    if (balancesByAddress[wallet].isZero()) {
      delete balancesByAddress[wallet];
    }
  }

  await saveBalance(balancesByAddress, endBlock, tokenAddress);

  return balancesByAddress;
}

async function getSushiFarmBalances(masterChefV2: string, genesisBlock: number, endBlock: number, batchSize: number, provider: Provider) {
  const balancesByAddress: { [wallet: string]: BigNumber } = await loadBalance(endBlock, masterChefV2);

  if (Object.entries(balancesByAddress).length > 0) {
    return balancesByAddress;
  }

  const depositEventID = MASTER_CHEF_V2.getEventTopic("Deposit");
  const withdrawEventID = MASTER_CHEF_V2.getEventTopic("Withdraw");

  for (let startBlock = genesisBlock; startBlock <= endBlock;) {
    let blocksToGet;
    let toBlock;
    let logs: Log[];

    while (true) {
      blocksToGet = Math.min(endBlock - startBlock + 1, batchSize);
      toBlock = startBlock + blocksToGet - 1;

      try {
        logs = await provider.getLogs({
          fromBlock: startBlock,
          toBlock: toBlock,
          address: masterChefV2,
          topics: [
            [depositEventID, withdrawEventID],
          ],
        });

        break;
      } catch (err) {
        if (('' + err).includes("query returned more than")) {
          batchSize = Math.trunc(batchSize / 2);
          continue;
        }

        throw err;
      }
    }

    const logsByBlocks: { [block: number]: Log[] } = {};

    logs.filter(log => log.topics[2] === '0x000000000000000000000000000000000000000000000000000000000000002d')
      .forEach(log => {
        if (!logsByBlocks[log.blockNumber]) logsByBlocks[log.blockNumber] = [];
        logsByBlocks[log.blockNumber].push(log);
      });

    for (let block = startBlock; block <= toBlock; block++) {
      if (!logsByBlocks[block]) continue;

      logsByBlocks[block].sort((a, b) => a.logIndex - b.logIndex);

      for (const log of logsByBlocks[block]) {
        if (log.topics[0] === depositEventID) {
          const event = MASTER_CHEF_V2.parseLog(log);
          const args = event.args as any as MasterChefV2DepositArgs;

          console.log("[%d|%s] %s deposit %d SLP to %s",
            log.blockNumber,
            log.logIndex.toString().padStart(3),
            args.user,
            args.amount,
            args.to);

          balancesByAddress[args.to] = (balancesByAddress[args.to] ?? BigNumber.from(0)).add(args.amount);
        } else {
          const event = MASTER_CHEF_V2.parseLog(log);
          const args = event.args as any as MasterChefV2DepositArgs;

          console.log("[%d|%s] %s withdraw %d SLP to %s",
            log.blockNumber,
            log.logIndex.toString().padStart(3),
            args.user,
            args.amount,
            args.to);

          balancesByAddress[args.user] = balancesByAddress[args.user].sub(args.amount);
        }
      }
    }

    startBlock += blocksToGet;
  }

  for (const wallet in balancesByAddress) {
    if (balancesByAddress[wallet].isZero()) {
      delete balancesByAddress[wallet];
    }
  }

  await saveBalance(balancesByAddress, endBlock, masterChefV2);

  return balancesByAddress;
}

interface Balance {
  account: string;
  sosBalance: BigNumber;
  normalizedSosBalance: BigNumber;
  veSosBalance: BigNumber;
  normalizedVeSosBalance: BigNumber;
  slpBalance: BigNumber;
  normalizedSlpBalance: BigNumber;

  sosPower: BigNumber;
};

function getPercentiles(balances: { [wallet: string]: Balance }, ...percentiles: number[]) {
  const arr = Object.values(balances);
  arr.sort((a, b) => a.sosPower.sub(b.sosPower).isNegative() ? -1 : 0);

  const result = percentiles.map(p => arr[Math.ceil(arr.length * p / 100) - 1]);
  return result;
}

async function main() {
  const provider = new ethers.providers.AlchemyProvider('mainnet', process.env.ALCHEMY_KEY);
  const endBlock = Number.parseInt(process.env.TARGET_BLOCK as string) || await provider.getBlockNumber();

  const veSOSContract = new ethers.Contract(VESOS_ADDRESS, VESOS_ABI_SLIM, provider);
  const slpContract = new ethers.Contract(SLP_ADDRESS, ERC20_ABI_SLIM, provider);
  const sosContract = new ethers.Contract(SOS_ADDRESS, ERC20_ABI_SLIM, provider);

  const sosInStakingPool: BigNumber = await veSOSContract.getSOSPool({ blockTag: endBlock });
  const veSOSTotalSupply: BigNumber = await veSOSContract.totalSupply({ blockTag: endBlock });
  const slpTotalSupply: BigNumber = await slpContract.totalSupply({ blockTag: endBlock });
  const sosInSlpPool: BigNumber = await sosContract.balanceOf(SLP_ADDRESS, { blockTag: endBlock });

  const [sosBalances, veSosBalances, unstakedSlpBalances, stakedSlpBalances] = await Promise.all([
    getERC20Balances(SOS_ADDRESS, SOS_GENESIS_BLOCK, endBlock, 200, provider),
    getERC20Balances(VESOS_ADDRESS, VESOS_GENESIS_BLOCK, endBlock, 10000, provider),
    getERC20Balances(SLP_ADDRESS, SLP_GENESIS_BLOCK, endBlock, 10000, provider),
    getSushiFarmBalances(MASTER_CHEF_V2_ADDRESS, SLP_GENESIS_BLOCK, endBlock, 5000, provider),
  ]);

  const balancesByAddress: { [wallet: string]: Balance } = {};

  function ensureBalanceInitialized(wallet: string) {
    if (!balancesByAddress[wallet]) {
      balancesByAddress[wallet] = {
        account: wallet,
        sosBalance: BigNumber.from(0),
        veSosBalance: BigNumber.from(0),
        slpBalance: BigNumber.from(0),
        normalizedSosBalance: BigNumber.from(0),
        normalizedVeSosBalance: BigNumber.from(0),
        normalizedSlpBalance: BigNumber.from(0),
        sosPower: BigNumber.from(0),
      };
    }
  }

  Object.entries(sosBalances).forEach(([wallet, value]) => {
    ensureBalanceInitialized(wallet);
    balancesByAddress[wallet].sosBalance = value;
  });

  Object.entries(veSosBalances).forEach(([wallet, value]) => {
    ensureBalanceInitialized(wallet);
    balancesByAddress[wallet].veSosBalance = value;
  });

  Object.entries(unstakedSlpBalances).forEach(([wallet, value]) => {
    ensureBalanceInitialized(wallet);
    balancesByAddress[wallet].slpBalance = value;
  });

  Object.entries(stakedSlpBalances).forEach(([wallet, value]) => {
    ensureBalanceInitialized(wallet);
    balancesByAddress[wallet].slpBalance = balancesByAddress[wallet].slpBalance.add(value);
  });

  for (const wallet in balancesByAddress) {
    balancesByAddress[wallet].normalizedSosBalance = balancesByAddress[wallet].sosBalance.div(10);

    if (!balancesByAddress[wallet].veSosBalance.isZero()) {

      balancesByAddress[wallet].normalizedVeSosBalance = BigNumber.from(1)
        .mul(balancesByAddress[wallet].veSosBalance)
        .mul(sosInStakingPool)
        .div(veSOSTotalSupply);
    }

    balancesByAddress[wallet].normalizedSlpBalance = BigNumber.from(1)
      .mul(balancesByAddress[wallet].slpBalance)
      .mul(sosInSlpPool)
      .mul(2)
      .div(slpTotalSupply);

    balancesByAddress[wallet].sosPower = BigNumber.from(0)
      .add(balancesByAddress[wallet].normalizedSosBalance)
      .add(balancesByAddress[wallet].normalizedVeSosBalance)
      .add(balancesByAddress[wallet].normalizedSlpBalance);
  }

  for (const wallet in balancesByAddress) {
    if (balancesByAddress[wallet].sosPower.isZero()) {
      delete balancesByAddress[wallet];
    }

    if (COMMON_TREASURY.has(wallet.toLowerCase())) {
      delete balancesByAddress[wallet];
    }
  }

  const fd = await promisify(open)(join(OUTPUT_DIR, "sos-power-" + endBlock + ".csv"), "w");
  await promisify(write)(fd, "account,sosPower,sosBalance,veSosBalance,slpBalance,normalizedSosBalance,normalizedVeSosBalance,normalizedSlpBalance\r\n");

  for (const wallet in balancesByAddress) {
    let content = [
      wallet,
      balancesByAddress[wallet].sosPower.toString(),
      balancesByAddress[wallet].sosBalance.toString(),
      balancesByAddress[wallet].veSosBalance.toString(),
      balancesByAddress[wallet].slpBalance.toString(),
      balancesByAddress[wallet].normalizedSosBalance.toString(),
      balancesByAddress[wallet].normalizedVeSosBalance.toString(),
      balancesByAddress[wallet].normalizedSlpBalance.toString(),
    ].join(",") + "\r\n";

    await promisify(write)(fd, content);
  }

  await promisify(close)(fd);

  const percentiles = [15, 25, 35, 50, 60, 75, 80, 90, 95, 99, 99.9, 99.99, 99.999];
  const result = getPercentiles(balancesByAddress, ...percentiles);
  for (let i = 0; i < percentiles.length; i++) {
    const data = result[i];

    console.log(`P${percentiles[i]} ${data.account} ${data.sosPower.div(ethers.utils.parseEther("1")).toString()}`);
  }
}

main()
  .then(() => process.exit())
  .catch((err) => {
    console.error(err);
    process.exit(-1);
  });