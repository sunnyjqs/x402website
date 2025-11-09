import { useState, useEffect } from "react";  
import axios, { type AxiosInstance } from "axios";  
import { withPaymentInterceptor, decodeXPaymentResponse } from "x402-axios";  
import { createWalletClient, custom, publicActions } from "viem";  
import { base } from "viem/chains";
import "~/utils/buffer-polyfill";

type ChainType = "base" | "solana";

class X402MetaMaskClient {  
  public walletClient: any = null;  
  public httpClient: AxiosInstance | null = null;  
  public address: string | null = null;  
  public chain: ChainType = "base";
  
  async initialize() {  
    const result = await this.createMetaMaskWallet();  
    this.walletClient = result.walletClient;
    this.address = result.address;
    
    const axiosInstance = axios.create({  
      baseURL: "http://localhost:8000",  
      timeout: 30000,
    });

    this.httpClient = withPaymentInterceptor(axiosInstance, this.walletClient);  
  }  
  
  private async createMetaMaskWallet() {  
    if (!(window as any).ethereum) {  
      throw new Error("请安装 MetaMask 钱包");  
    }  
    await (window as any).ethereum.request({ method: "eth_requestAccounts" });  
    await this.switchToBaseNetwork();  

    const baseClient = createWalletClient({    
      chain: base,    
      transport: custom((window as any).ethereum),    
    }).extend(publicActions)    
        
    const accounts = await baseClient.getAddresses()    
    if (!accounts || accounts.length === 0) {    
      throw new Error('未找到连接的账户')    
    }  
      
    const walletClient = createWalletClient({  
      chain: base,  
      transport: custom((window as any).ethereum),  
      account: accounts[0],  
    }).extend(publicActions);
    
    return {
      walletClient,
      address: accounts[0]
    };
  }  
  
  private async switchToBaseNetwork() {  
    try {  
      await (window as any).ethereum.request({  
        method: "wallet_switchEthereumChain",  
        params: [{ chainId: "0x2105" }],  
      });  
    } catch (switchError: any) {  
      if (switchError.code === 4902) {  
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x2105",
            chainName: "Base",
            nativeCurrency: {
              name: "Ethereum",
              symbol: "ETH",
              decimals: 18,
            },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          }],
        });
      }  
    }  
  }  
}  

class X402SolanaClient {  
  public x402Client: any = null;  
  public httpClient: any = null;  
  public address: string | null = null;  
  public chain: ChainType = "solana";  
  private phantomWallet: any = null;

  async initialize() {  
    // 等待 Buffer polyfill 加载完成
    await this.waitForBuffer();
    
    // 🎉 动态导入 x402-solana（只在客户端）
    const { X402Client } = await import("x402-solana/client");
    
    // 连接 Phantom 钱包
    this.phantomWallet = await this.connectPhantomWallet();  
    this.address = this.phantomWallet.address;  
    
    // 使用官方的 x402-solana 客户端
    this.x402Client = new X402Client({
      network: "solana-devnet",
      wallet: this.phantomWallet,  // ⬅️ 直接传递完整的 wallet 对象（包含 publicKey）
      rpcUrl: "https://api.devnet.solana.com",
    });
    
    // 创建一个兼容原来 axios 接口的 httpClient
    this.httpClient = {
      get: async (url: string) => {
        const fullUrl = `http://localhost:8000${url}`;
        const response = await this.x402Client.fetch(fullUrl);
        
        // 将 fetch Response 转换为类似 axios 的响应
        const data = await response.json();
        return {
          data,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        };
      },
    };
    
    console.log("✅ Solana x402 客户端初始化成功（官方版 - x402-solana）");
    console.log("地址:", this.address);
    console.log("🌐 网络: solana-devnet");
    console.log("💵 支付代币: USDC (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)");
    console.log("⚠️ 重要：请确保 Phantom 钱包已切换到 Devnet 网络！");
  }  

  private async waitForBuffer() {
    // 等待 Buffer polyfill 加载（最多 5 秒）
    const maxWait = 5000;
    const startTime = Date.now();
    
    while (!window.Buffer && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!window.Buffer) {
      console.warn("⚠️ Buffer polyfill 未加载，尝试同步加载...");
      const { Buffer } = await import("buffer");
      window.Buffer = Buffer;
      (window as any).global = window;
    }
    
    console.log("✅ Buffer 已准备就绪");
  }

  private async connectPhantomWallet() {
    // 检查 Phantom 钱包
    if (!(window as any).solana || !(window as any).solana.isPhantom) {
      throw new Error("请安装 Phantom 钱包");
    }
    
    try {
      // 检查并提示切换到 Devnet
      // Phantom 钱包的网络切换需要在钱包 UI 中手动完成
      // 但我们可以在连接时检查并提示用户
      const resp = await (window as any).solana.connect();
      const publicKey = resp.publicKey;  // Solana PublicKey 对象
      const address = publicKey.toString();
      
      // 提示用户切换到 Devnet（如果还没有切换）
      console.log("⚠️ 请确保 Phantom 钱包已切换到 Devnet 网络！");
      console.log("   在 Phantom 钱包中：设置 → 开发者模式 → 更改网络 → Devnet");
      
      // 创建符合官方 API 的钱包适配器
      return {
        publicKey: {  // ⬅️ 添加 publicKey 对象
          toString: () => address
        },
        address,
        signTransaction: async (transaction: any): Promise<any> => {
          return await (window as any).solana.signTransaction(transaction);
        },
      };
    } catch (err: any) {
      throw new Error(`Phantom 钱包连接失败: ${err.message}`);
    }
  }
}  

export default function Welcome() {  
  const [client, setClient] = useState<X402MetaMaskClient | X402SolanaClient | null>(null);  
  const [loading, setLoading] = useState(false);  
  const [error, setError] = useState<string | null>(null);  
  const [weatherData, setWeatherData] = useState<any>(null);  
  const [paymentInfo, setPaymentInfo] = useState<any>(null);  
  const [chain, setChain] = useState<ChainType>("base");

  const connect = async (selectedChain: ChainType) => {  
    setLoading(true);  
    setError(null);  
    try {
      let newClient: X402MetaMaskClient | X402SolanaClient;
      
      if (selectedChain === "base") {
        newClient = new X402MetaMaskClient();
      } else {
        newClient = new X402SolanaClient();
      }
      
      await newClient.initialize();
      setClient(newClient);
      setChain(selectedChain);
    } catch (err: any) {  
      setError(err.message || "连接失败");  
    } finally {  
      setLoading(false);  
    }  
  };  

  const disconnect = () => {  
    setClient(null);  
    setWeatherData(null);  
    setPaymentInfo(null);  
    setError(null);  
  };  

  // 查询 Base 链的数据
  const fetchBaseData = async (item: "item1" | "item2") => {
    if (!client) {  
      setError("请先连接钱包");  
      return;  
    }  
    if (client.chain !== "base") {
      setError("请使用 Base 链连接钱包");
      return;
    }
    setLoading(true);  
    setError(null);  
    setPaymentInfo(null);  
    try {  
      const response = await client.httpClient!.get(`/${item}`);  
      setWeatherData(response.data);  
      if (response.headers["x-payment-response"]) {  
        const paymentResponse = decodeXPaymentResponse(response.headers["x-payment-response"]);  
        setPaymentInfo(paymentResponse);  
      }  
    } catch (err: any) {  
      setError(err.message || "获取数据失败");  
    } finally {  
      setLoading(false);  
    }  
  };  

  // 查询 Solana devnet 链的 item3
  const fetchSolanaData = async () => {
    if (!client) {  
      setError("请先连接钱包");  
      return;  
    }  
    if (client.chain !== "solana") {
      setError("请使用 Solana 链连接钱包");
      return;
    }
    setLoading(true);  
    setError(null);  
    setPaymentInfo(null);  
    try {  
      const response = await client.httpClient!.get("/item3");  
      setWeatherData(response.data);  
      console.log("x-payment-response", response.headers["x-payment-response"]);
      if (response.headers["x-payment-response"]) {  
        // x402-solana 的响应可以直接解码
        try {
          const decoded = atob(response.headers["x-payment-response"]);
          const paymentResponse = JSON.parse(decoded);
          console.log("paymentResponse", paymentResponse);
          setPaymentInfo(paymentResponse);  
        } catch (decodeErr) {
          console.error("解码 payment response 失败:", decodeErr);
        }
      }  
    } catch (err: any) {  
      setError(err.message || "获取数据失败");  
    } finally {  
      setLoading(false);  
    }  
  };  
  
  return (  
    <main className="flex items-center justify-center pt-16 pb-4">  
      <div className="flex-1 flex flex-col items-center gap-16 min-h-0">  
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex gap-4">
            <button
              onClick={() => {
                console.log("点击 Base 按钮");
                if (client) {
                  disconnect();
                }
                setChain("base");
              }}
              className={`px-4 py-2 rounded-lg transition-all ${
                chain === "base" 
                  ? "bg-blue-600 text-white shadow-lg" 
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              } ${(loading || (client && chain !== "base")) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              disabled={loading}
            >
              Base Sepolia {chain === "base" && "✓"}
            </button>
            <button
              onClick={() => {
                console.log("点击 Solana 按钮");
                if (client) {
                  disconnect();
                }
                setChain("solana");
              }}
              className={`px-4 py-2 rounded-lg transition-all ${
                chain === "solana"
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              disabled={loading}
            >
              Solana Devnet 🎉 {chain === "solana" && "✓"}
            </button>
          </div>
          
          {!client ? (
            <button  
              onClick={() => connect(chain)}  
              disabled={loading}  
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"  
            >  
              {loading ? "连接中..." : `连接 ${chain === "base" ? "MetaMask" : "Phantom"} 钱包`}  
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-gray-600">
                已连接: {client.address?.slice(0, 6)}...{client.address?.slice(-4)} ({chain === "base" ? "Base" : "Solana"})
              </div>
              <button  
                onClick={disconnect}  
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"  
              >  
                断开连接  
              </button>
            </div>
          )}
        </div>

        {client && (
          <div className="flex gap-4">
            {chain === "base" && (
              <>
                <button  
                  onClick={() => fetchBaseData("item1")}  
                  disabled={loading}  
                  className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-all"  
                >  
                  获取 Item 1 数据  
                </button>  
                <button  
                  onClick={() => fetchBaseData("item2")}  
                  disabled={loading}  
                  className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-all"  
                >  
                  获取 Item 2 数据  
                </button>
              </>
            )}
            
            {chain === "solana" && (
              <>
                <button  
                  onClick={fetchSolanaData}  
                  disabled={loading}  
                  className="px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-all"  
                >  
                  获取 Item 3 数据 (Solana)
                </button>
                <div className="text-sm text-yellow-600 bg-yellow-50 px-4 py-2 rounded-lg border border-yellow-200">
                  ⚠️ 请确保 Phantom 钱包已切换到 <strong>Devnet</strong> 网络，并且账户有 USDC 代币！
                  <br />
                  <span className="text-xs text-gray-600">设置 → 开发者模式 → 更改网络 → Devnet</span>
                </div>
              </>
            )}
          </div>
        )}

        {loading && <div className="text-blue-500">加载中...</div>}  
        {error && <div className="text-red-500 bg-red-50 px-4 py-2 rounded">{error}</div>}  
        {weatherData && (  
          <div className="p-6 bg-white rounded-lg shadow-lg">  
            <h2 className="text-xl font-bold mb-4">天气数据</h2>  
            <pre className="text-sm bg-gray-50 p-4 rounded overflow-auto max-w-2xl">  
              {JSON.stringify(weatherData, null, 2)}  
            </pre>  
          </div>  
        )}  
        {paymentInfo && (  
          <div className="p-6 bg-blue-50 rounded-lg shadow-lg">  
            <h2 className="text-xl font-bold mb-4 text-blue-700">支付信息</h2>  
            <pre className="text-sm bg-white p-4 rounded overflow-auto max-w-2xl">  
              {JSON.stringify(paymentInfo, null, 2)}  
            </pre>  
          </div>  
        )}  
      </div>  
    </main>  
  );  
}
