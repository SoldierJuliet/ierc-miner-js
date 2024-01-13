import { ethers } from "ethers";
import { GAS_PREMIUM, PROVIDER_RPC, ZERO_ADDRESS } from "../constants";
import { DataBase } from "../db";
import { sleep } from "../utils/program";
import { stringToHex } from "../utils/hex";
import Spinnies from "spinnies";
import { printer } from "../utils/log4js";
import { bnUtils } from "../utils/bn";
import { sayMinerLog } from "../utils/prompts";
import dayjs from "dayjs";
import { generateNonce } from "../utils";

interface IMineOptions {
  account: string;
}
const tick = "ethpi";
let lastNonce:any=undefined;
let unique = 0;
let toMintBlockNumber = 0;
let totalMintCount=0;
export const runMintPow = async (workc: string, options: IMineOptions) => {

  try{
  unique=0;
  sayMinerLog();
  toMintBlockNumber = 0;
  if (!(workc.length >= 6 && workc.length <= 22 && ethers.utils.isHexString(workc))) {
    throw new Error("The workc is invalid");
  }
  const { account } = options;
  if (!(await DataBase.miner.exists(`/${account}`))) {
    console.log(`
This mining user configuration was not found!
💡 Tips: 
1. cli wallet ---set <privateKey> Import the user.
2. cli wallet --all to see configured users
- For more information, use cli help wallet
        `);
    throw new Error("Mining user configuration not found");
  }

  printer.trace(`Start mining with ${account}`);
  const { privateKey } = await DataBase.miner.getObject<{ privateKey: string }>(`/${account}`);
  const provider = new ethers.providers.JsonRpcProvider(PROVIDER_RPC);
  const miner = new ethers.Wallet(privateKey, provider);

  const [network, currentGasPrice, blockNumber, nonce, balance] = await Promise.all([
    provider.getNetwork(),
    provider.getGasPrice(),
    provider.getBlockNumber(),
    miner.getTransactionCount(),
    miner.getBalance(),
  ]);

  if(lastNonce==undefined)
  {
    lastNonce=nonce
  }else{
    lastNonce=lastNonce+1
  }

  printer.trace(`network is ${network.name} (chainID: ${network.chainId})`);
  const targetGasFee = currentGasPrice.div(100).mul(GAS_PREMIUM);

  printer.trace(`Current gas price usage ${bnUtils.fromWei(targetGasFee.toString(), 9)} gwei`);
  printer.trace(`nonce is ${lastNonce}`);
  printer.trace(`balance is ${bnUtils.fromWei(balance.toString(), 18).dp(4).toString()}`);

  printer.info(`totalSuccessMint is ${totalMintCount}`);
  const spinnies = new Spinnies();
  printer.trace(`The current mining difficulty is ${workc}`);
  printer.trace(`Expected to take 1-2 minutes to calculate...`);
  spinnies.add("mining", { text: "start mining...", color: "blue" });
  await sleep(1000);
  let timer = Date.now(),
    startTimer = timer,
    mineCount = 0;
  toMintBlockNumber = blockNumber + 3;
  setInterval(() => {
    toMintBlockNumber += 1;
  }, 1000 * 12);
  while (true) {
    mineCount += 1;
    const transaction = {
      type: 2,
      chainId: network.chainId,
      to: ZERO_ADDRESS,
      maxPriorityFeePerGas: targetGasFee,
      maxFeePerGas: targetGasFee,
      gasLimit: ethers.BigNumber.from("25000"),
      nonce: lastNonce,
      value: ethers.utils.parseEther("0"),
      data: stringToHex(
        `data:application/json,${JSON.stringify({
          p: "ierc-pow",
          op: "mint",
          tick: tick,
          // use_point: '0',
          block: String(toMintBlockNumber),
          nonce: `${generateNonce()}`,
        })}`
      ),
    };
    const rawTransaction = ethers.utils.serializeTransaction(transaction);
    const transactionHash = ethers.utils.keccak256(rawTransaction);
    // console.log("🚀 ~ transactionHash:", transactionHash)

    const signingKey = miner._signingKey();
    const signature = signingKey.signDigest(transactionHash);
    // console.log("🚀 ~ signature:", signature)

    const recreatedSignature = ethers.utils.joinSignature(signature);
    // console.log("🚀 ~ recreatedSignature:", recreatedSignature)

    const predictedTransactionHash = ethers.utils.keccak256(
      ethers.utils.serializeTransaction(transaction, recreatedSignature)
    );

    // console.log("🚀 ~ predictedTransactionHash:", predictedTransactionHash)
    const now = Date.now();
    if (now - timer > 100) {
      await sleep(1);
      spinnies.update("mining", {
        text: `[${dayjs(now).format(
          "YYYY-MM-DD HH:mm:ss"
        )}] ${mineCount} - ${predictedTransactionHash}`,
        color: "red",
      });
      timer = now;
    }
    if (predictedTransactionHash.includes(workc)) {
      unique = 0;
      const currentBlockNumber = await provider.getBlockNumber();
      if (Math.abs(currentBlockNumber - toMintBlockNumber) > 5) {
        spinnies.fail("mining", {
          text: `The current block height is ${currentBlockNumber}, the expected block height is ${toMintBlockNumber}, the difference is too large, and the mining is stopped.`,
          color: "red",
        });
        break;
      }
      spinnies.succeed("mining", {
        text: `${mineCount} - ${predictedTransactionHash}`,
        color: "green",
      });
      const mineTime = (Date.now() - startTimer) / 1000;
      printer.info(
        `Total time spent ${mineTime}s, average arithmetic ${Math.ceil(mineCount / mineTime)} c/s`
      );
      // console.log("🚀 ~ transaction:", transaction)
      const realTransaction = await miner.sendTransaction(transaction);
      // console.log("🚀 ~ realTransaction:", realTransaction)
      printer.info(`mining hash: ${realTransaction.hash}`);
     // await realTransaction.wait();

       printer.info("mining success");
       totalMintCount=totalMintCount+1;

       break;
    }
  }
}catch(ex)
{
  console.log('执行异常：',ex)
}
 await runMintPow(workc,options)
};
