import { performSwap } from './swap';

async function main() {
    const wallet = {
        address: '0xYourWalletAddress',
        privateKey: '0xYourPrivateKey'
    };

    const fromToken = {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // WETH (Ethereum)
    };

    const toToken = {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT (Ethereum)
    };

    const fromChain = { name: 'Ethereum', id: 1 };
    const toChain = { name: 'Ethereum', id: 1 }; // Same-chain swap in this case

    const transactionRepository = {
        create: (data) => data,
        save: async (tx) => console.log('Transaction saved:', tx)
    };

    try {
        const txHash = await performSwap({
            wallet,
            fromToken,
            toToken,
            amount: 10, // 10 WETH
            fromChain,
            toChain,
            transactionRepository
        });
        console.log('Swap successful. TX Hash:', txHash);
    } catch (err) {
        console.error('Swap failed:', err.message);
    }
}

main();
