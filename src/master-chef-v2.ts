import { BigNumber, ethers } from "ethers";

export interface MasterChefV2DepositArgs {
  user: string;
  to: string;
  pid: BigNumber;
  amount: BigNumber;
}

export interface MasterChefV2WithdrawArgs {
  user: string;
  to: string;
  pid: BigNumber;
  amount: BigNumber;
}

export const MASTER_CHEF_V2_ABI_SLIM = [
  "function userInfo(uint256 pid, address account) external view returns (uint256 amount, uint256 debt)",
  "event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to)",
  "event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to)",
];

export const MASTER_CHEF_V2 = new ethers.utils.Interface(MASTER_CHEF_V2_ABI_SLIM);
