import { ethers } from "ethers";
import { ERC20_ABI_SLIM } from "./erc20";

export const VESOS_ABI_SLIM = [
  "function getSOSPool() public view returns(uint256)",
  ...ERC20_ABI_SLIM,
];

export const VESOS = new ethers.utils.Interface(VESOS_ABI_SLIM);
