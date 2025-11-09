/**
 * Solana x402 Payment Client
 * 手动实现 x402 协议用于 Solana 支付
 * 
 * x402 协议流程：
 * 1. 发送请求到受保护的资源
 * 2. 收到 402 响应和支付要求
 * 3. 创建并签名交易
 * 4. 使用支付头重试请求
 */

import axios, { type AxiosInstance, type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { base58 } from "@scure/base";

// 动态导入 SPL Token（避免在 Buffer 准备前加载）
let splTokenModule: any = null;
async function getSPLToken() {
  if (!splTokenModule) {
    splTokenModule = await import("@solana/spl-token");
  }
  return splTokenModule;
}

// x402 支付要求类型
interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: {
    feePayer?: string;
    [key: string]: any;
  };
}

// x402 402 响应类型
interface X402Response {
  x402Version: number;
  accepts: PaymentRequirements[];
}

// Solana 钱包接口
export interface SolanaSigner {
  publicKey: PublicKey;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions?: (transactions: Transaction[]) => Promise<Transaction[]>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

/**
 * 创建带有 x402 支持的 Solana HTTP 客户端
 */
export function createSolanaX402Client(
  baseURL: string,
  signer: SolanaSigner,
  rpcUrl: string = "https://api.devnet.solana.com"
): AxiosInstance {
  const connection = new Connection(rpcUrl, "confirmed");
  const client = axios.create({ baseURL });

  // 添加响应拦截器处理 402
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      // 只处理 402 错误
      if (error.response?.status !== 402) {
        return Promise.reject(error);
      }

      const x402Response = error.response.data as X402Response;
      console.log("收到 402 响应:", x402Response);

      // 选择第一个支付要求（通常服务器会返回多个选项）
      const paymentReq = x402Response.accepts?.[0];
      if (!paymentReq) {
        return Promise.reject(new Error("服务器未提供支付选项"));
      }

      // 验证是否为 Solana 网络
      if (!paymentReq.network.includes("solana")) {
        console.warn(`⚠️ 警告：服务器返回的网络是 ${paymentReq.network}，但当前使用的是 Solana 客户端`);
        console.log("完整支付要求:", paymentReq);
        return Promise.reject(
          new Error(`不支持的网络: ${paymentReq.network}。请检查后端 /item3 接口配置，应返回 solana-devnet 网络。`)
        );
      }

      try {
        // 创建支付交易
        const paymentHeader = await createSolanaPaymentHeader(
          signer,
          paymentReq,
          connection
        );

        // 重试原始请求，带上支付头
        const originalRequest = error.config!;
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers["X-Payment"] = paymentHeader;
        originalRequest.headers["Access-Control-Expose-Headers"] = "X-Payment-Response";

        console.log("使用支付头重试请求...");
        console.log("📤 X-Payment 头:", paymentHeader.substring(0, 100) + "...");
        const retryResponse = await client.request(originalRequest);
        
        // 打印支付响应
        if (retryResponse.headers["x-payment-response"]) {
          console.log("支付响应头:", retryResponse.headers["x-payment-response"]);
        }
        
        return retryResponse;
      } catch (paymentError) {
        console.error("支付处理失败:", paymentError);
        return Promise.reject(paymentError);
      }
    }
  );

  return client;
}

/**
 * 创建 Solana 支付头
 */
async function createSolanaPaymentHeader(
  signer: SolanaSigner,
  paymentReq: PaymentRequirements,
  connection: Connection
): Promise<string> {
  console.log("创建 Solana 支付交易...", paymentReq);

  // 解析收款地址
  const payToPublicKey = new PublicKey(paymentReq.payTo);
  
  // 将金额从字符串转换为最小单位
  const amount = parseInt(paymentReq.maxAmountRequired);
  
  // 获取最新的区块哈希
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  // 创建转账交易
  const transaction = new Transaction({
    feePayer: signer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  // 判断是 SOL 还是 SPL Token
  if (paymentReq.asset === "SOL" || !paymentReq.asset) {
    // SOL 原生代币转账
    console.log(`创建 SOL 转账: ${amount} lamports`);
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: payToPublicKey,
        lamports: amount,
      })
    );
  } else {
    // SPL Token 转账（如 USDC）
    console.log(`创建 SPL Token 转账: ${amount} 最小单位`);
    
    // 🧪 实验选项：是否创建空交易（0个指令）
    // 类似 EVM 的 EIP-3009，可能只需要签名，不需要实际指令
    const USE_EMPTY_TRANSACTION = false; // 改为 true 尝试空交易
    
    if (USE_EMPTY_TRANSACTION) {
      console.warn('🧪 实验模式：创建空交易（0个指令）');
      console.warn('PayAI 可能会用签名来授权 Facilitator 执行转账');
      // 不添加任何指令，直接签名
    } else {
    
    // 动态导入 SPL Token
    const spl = await getSPLToken();
    const {
      getAssociatedTokenAddress,
      createAssociatedTokenAccountInstruction,
      createTransferInstruction,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    } = spl;
    
    const mintPublicKey = new PublicKey(paymentReq.asset);
    
    // 获取发送方的关联代币账户（ATA）
    const fromTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      signer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // 获取接收方的关联代币账户（ATA）
    const toTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      payToPublicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // 检查接收方的代币账户是否存在
    const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
    
    if (!toAccountInfo) {
      console.warn(`⚠️ 警告：接收方代币账户不存在: ${toTokenAccount.toBase58()}`);
      console.warn('需要先创建 ATA，然后再转账');
      
      // 添加创建 ATA 的指令
      transaction.add(
        createAssociatedTokenAccountInstruction(
          signer.publicKey,        // payer
          toTokenAccount,          // associated token account
          payToPublicKey,          // owner
          mintPublicKey,           // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      
      console.log('✅ 已添加创建 ATA 指令');
    }
    
    // 添加代币转账指令
    transaction.add(
      createTransferInstruction(
        fromTokenAccount,   // source
        toTokenAccount,     // destination
        signer.publicKey,   // owner
        amount,             // amount
        [],                 // multiSigners
        TOKEN_PROGRAM_ID
      )
    );
    
    console.log(`SPL Token 转账详情:
      - Token Mint: ${mintPublicKey.toBase58()}
      - From ATA: ${fromTokenAccount.toBase58()}
      - To ATA: ${toTokenAccount.toBase58()}
      - Amount: ${amount}
    `);
    } // 闭合 USE_EMPTY_TRANSACTION 的 else
  }

  // 打印交易详情用于调试
  console.log("📋 交易详情:");
  console.log("- 指令数量:", transaction.instructions.length);
  console.log("- Fee Payer:", transaction.feePayer?.toBase58());
  console.log("- Blockhash:", transaction.recentBlockhash);
  
  // 打印每个指令的详细信息
  transaction.instructions.forEach((ix, i) => {
    console.log(`📝 指令 ${i}:`, {
      programId: ix.programId.toBase58(),
      keys: ix.keys.length,
      data: ix.data.length + ' bytes',
      keysDetail: ix.keys.map(k => ({
        pubkey: k.pubkey.toBase58().substring(0, 8) + '...',
        isSigner: k.isSigner,
        isWritable: k.isWritable
      }))
    });
  });
  
  // 🧪 实验模式选择
  const EXPERIMENTAL_MODE = "MESSAGE_ONLY"; // 可选: "SIGNED_TX", "MESSAGE_ONLY", "EMPTY_TX"
  
  console.log(`🧪 实验模式: ${EXPERIMENTAL_MODE}`);
  
  let signedTransaction: any;
  let base64Transaction: string;
  
  if (EXPERIMENTAL_MODE === "MESSAGE_ONLY") {
    // 模式1：只发送交易消息（未签名）- 类似 EIP-3009
    console.log("📝 创建交易消息（未签名）...");
    const message = transaction.compileMessage();
    const messageBytes = message.serialize();
    // 使用浏览器兼容的 base64 编码
    base64Transaction = btoa(String.fromCharCode(...messageBytes));
    console.log("✅ 消息创建成功（未签名）");
    console.log("📊 MESSAGE_ONLY: 错误信息与其他模式不同，可能是正确方向！");
  } else if (EXPERIMENTAL_MODE === "EMPTY_TX") {
    // 模式2：空交易（0个指令）- 只用于授权
    console.log("🔐 创建空交易（仅签名）...");
    const emptyTx = new Transaction({
      feePayer: signer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    signedTransaction = await signer.signTransaction(emptyTx);
    base64Transaction = signedTransaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64");
    console.log("✅ 空交易创建成功");
  } else {
    // 模式3：标准签名交易（当前）
    console.log("签名交易...");
    signedTransaction = await signer.signTransaction(transaction);
  
    console.log("📋 签名后交易:");
    console.log("- 签名数量:", signedTransaction.signatures.length);
    signedTransaction.signatures.forEach((sig: any, i: number) => {
      console.log(`  签名 ${i}:`, sig.publicKey?.toBase58(), sig.signature ? "✅" : "❌");
    });

    // 序列化交易为 base64
    const serializedTransaction = signedTransaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    base64Transaction = serializedTransaction.toString("base64");
    
    console.log("📦 序列化后大小:", serializedTransaction.length, "bytes");
    
    // 验证反序列化（仅签名交易模式）
    try {
      const { Transaction } = await import("@solana/web3.js");
      const deserializedTx = Transaction.from(serializedTransaction);
      console.log("🔍 反序列化验证:");
      console.log("- 指令数量:", deserializedTx.instructions.length);
      console.log("- 签名数量:", deserializedTx.signatures.length);
      deserializedTx.instructions.forEach((ix, i) => {
        console.log(`  指令 ${i}: ${ix.programId.toBase58()}`);
      });
    } catch (err) {
      console.error("❌ 反序列化失败:", err);
    }
  }
  
  console.log("📦 最终 Base64 长度:", base64Transaction.length, "chars");

  // 创建 x402 支付负载
  // 尝试格式1：所有字段在顶层（类似 EVM）
  const paymentPayload1 = {
    x402Version: 1,
    scheme: paymentReq.scheme,
    network: paymentReq.network,
    asset: paymentReq.asset,
    payTo: paymentReq.payTo,
    transaction: base64Transaction,
  };

  // 尝试格式2：transaction 在 payload 字段内（修正版 - 只有 transaction）
  const paymentPayload2 = {
    x402Version: 1,
    scheme: paymentReq.scheme,
    network: paymentReq.network,
    payload: {
      transaction: base64Transaction,  // ✅ 只需要 transaction！
    },
  };

  // 尝试格式3：最小化结构
  const paymentPayload3 = {
    x402Version: 1,
    transaction: base64Transaction,
  };

  // 使用格式2（嵌套 payload - 尝试）
  const paymentPayload = paymentPayload2;

  console.log("📤 支付负载结构 (当前使用格式2):", {
    x402Version: paymentPayload.x402Version,
    scheme: paymentPayload.scheme || "N/A",
    network: paymentPayload.network || "N/A",
    asset: (paymentPayload as any).asset || "N/A",
    payTo: (paymentPayload as any).payTo || "N/A",
    transactionLength: base64Transaction.length
  });

  // 打印完整的 payload（用于调试）
  const payloadJSON = JSON.stringify(paymentPayload, null, 2);
  console.log("📋 完整 Payload JSON:");
  console.log(payloadJSON);

  // 将支付负载编码为 base64（浏览器兼容方式）
  const paymentHeader = btoa(JSON.stringify(paymentPayload));
  
  console.log("✅ 支付头创建成功，长度:", paymentHeader.length);
  console.log("📋 Base64 编码:", paymentHeader.substring(0, 100) + "...");
  return paymentHeader;
}

/**
 * 解码 x-payment-response 响应头（浏览器兼容方式）
 */
export function decodeSolanaPaymentResponse(header: string): any {
  try {
    const decoded = atob(header);
    return JSON.parse(decoded);
  } catch (error) {
    console.error("解码支付响应失败:", error);
    return null;
  }
}

