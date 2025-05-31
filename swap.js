import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

export const generateChainConfigs = () => {
  return {
    'Ethereum': {
      rpcUrl: process.env.ETHEREUM_RPC_URL,
      routerAddress: process.env.ETHEREUM_ROUTER_ADDRESS,
      middlewareTokens: [
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7'
      ]
    },
    'Base': {
      rpcUrl: process.env.BASE_RPC_URL,
      routerAddress: process.env.BASE_ROUTER_ADDRESS,
      middlewareTokens: [
        '0x4200000000000000000000000000000000000006',
        '0xd9AAEC86B65d86F6a7B5b1b0c42FFA531710B6CA'
      ]
    },
    'Polygon': {
      rpcUrl: process.env.POLYGON_RPC_URL,
      routerAddress: process.env.POLYGON_ROUTER_ADDRESS,
      middlewareTokens: [
        '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
      ]
    },
    'Binance': {
      rpcUrl: process.env.BSC_RPC_URL,
      routerAddress: process.env.BINANCE_ROUTER_ADDRESS,
      middlewareTokens: [
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        '0x55d398326f99059fF775485246999027B3197955'
      ]
    }
  };
};

export async function performSwap({
  wallet,
  fromToken,
  toToken,
  amount,
  fromChain,
  toChain,
  transactionRepository
}) {
  const chainConfigs = generateChainConfigs();
  const fromChainConfig = chainConfigs[fromChain.name];
  const toChainConfig = chainConfigs[toChain.name];

  if (!fromChainConfig || !toChainConfig) {
    throw new Error(`Unsupported chain(s): ${fromChain.name}, ${toChain.name}`);
  }

  const fromProvider = new ethers.JsonRpcProvider(fromChainConfig.rpcUrl);
  const signer = new ethers.Wallet(wallet.privateKey, fromProvider);

  const fromTokenContract = new ethers.Contract(fromToken.address, ['function decimals() view returns (uint8)'], fromProvider);
  const toTokenContract = new ethers.Contract(toToken.address, ['function decimals() view returns (uint8)'], fromProvider);

  const fromDecimals = await fromTokenContract.decimals();
  const toDecimals = await toTokenContract.decimals();

  const amountIn = ethers.parseUnits(amount.toString(), fromDecimals);
  const isCrossChain = fromChain.id !== toChain.id;
  const fee = amount * 0.01 + (isCrossChain ? 2 : 0);
  const feeAmount = ethers.parseUnits(fee.toString(), fromDecimals);
  const totalAmount = amountIn + feeAmount;

  const router = new ethers.Contract(fromChainConfig.routerAddress, [
    'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)'
  ], signer);

  const tokenContract = new ethers.Contract(fromToken.address, [
    'function balanceOf(address) view returns (uint)',
    'function allowance(address, address) view returns (uint)',
    'function approve(address, uint) returns (bool)',
    'function transfer(address, uint) returns (bool)'
  ], signer);

  const balance = await tokenContract.balanceOf(wallet.address);
  if (balance < totalAmount) throw new Error('Insufficient balance');

  const allowance = await tokenContract.allowance(wallet.address, fromChainConfig.routerAddress);
  if (allowance < amountIn) {
    const approvalTx = await tokenContract.approve(fromChainConfig.routerAddress, ethers.MaxUint256);
    await approvalTx.wait();
  }

  const paths = [[fromToken.address, toToken.address]];
  let selectedPath = null;
  let amountOut = null;

  for (const path of paths) {
    try {
      const out = await router.getAmountsOut(amountIn, path);
      selectedPath = path;
      amountOut = out[out.length - 1];
      break;
    } catch {}
  }

  if (!selectedPath || !amountOut) throw new Error('No valid path found');

  const amountOutMin = (amountOut * 99n) / 100n; // 1% slippage
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  const gasEstimate = await router.swapExactTokensForTokens.estimateGas(amountIn, amountOutMin, selectedPath, wallet.address, deadline);
  const gasCost = gasEstimate * (await fromProvider.getGasPrice());
  if ((await fromProvider.getBalance(wallet.address)) < gasCost) throw new Error('Insufficient gas');

  const feeCollector = process.env.WALLET_FEE_COLLECTOR;
  await tokenContract.transfer(feeCollector, feeAmount);

  const tx = await router.swapExactTokensForTokens(amountIn, amountOutMin, selectedPath, wallet.address, deadline);
  const receipt = await tx.wait();

  const transaction = transactionRepository.create({
    txHash: receipt.hash,
    amount,
    fromAddress: wallet.address,
    toAddress: wallet.address,
    status: 'COMPLETED',
    wallet,
    fromChainId: fromChain.name,
    toChainId: toChain.name,
    amountOutMin: amountOutMin.toString(),
    isCrossChain,
    feeAmount: fee.toString(),
    type: 'SWAP',
    fromToken,
    toToken
  });
  await transactionRepository.save(transaction);
  return receipt.hash;
}
