import { ethers } from "ethers";
import { BigNumber } from "ethers/lib/ethers";

export interface ERC20TransferArgs {
  from: string;
  to: string;
  value: BigNumber;
}

export const ERC20_ABI_SLIM = [
  "event Transfer(address indexed from, address indexed to, uint value)",
  "function balanceOf(address _owner) public view returns (uint256 balance)",
  "function totalSupply() external view returns (uint256)",
];

export const ERC20 = new ethers.utils.Interface(ERC20_ABI_SLIM);
