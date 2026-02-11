const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const RewardToken = await hre.ethers.getContractFactory("RewardToken");
  const token = await RewardToken.deploy("Crowd Reward", "CRWD", deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("RewardToken deployed to:", tokenAddress);

  const Crowdfunding = await hre.ethers.getContractFactory("Crowdfunding");
  const crowdfund = await Crowdfunding.deploy(tokenAddress);
  await crowdfund.waitForDeployment();
  const crowdfundAddress = await crowdfund.getAddress();
  console.log("Crowdfunding deployed to:", crowdfundAddress);

  const MINTER_ROLE = await token.MINTER_ROLE();
  const tx = await token.grantRole(MINTER_ROLE, crowdfundAddress);
  await tx.wait();
  console.log("Minter role granted to Crowdfunding contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });