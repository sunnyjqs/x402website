import { useState } from "react";  
import axios, { type AxiosInstance } from "axios";  
import { withPaymentInterceptor, decodeXPaymentResponse } from "x402-axios";  
import { createWalletClient, custom, publicActions } from "viem";  
import { base } from "viem/chains";  
  
class X402MetaMaskClient {  
  public walletClient: any = null;  
  public httpClient: AxiosInstance | null = null;  
  public address: string | null = null;  
  
  async initialize() {  
    this.walletClient = await this.createMetaMaskWallet();  
    this.address = this.walletClient.account.address;  
  
    const axiosInstance = axios.create({  
      baseURL: "https://pay.zen7.com/crypto",  
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
  
    // 创建基础客户端    
    const baseClient = createWalletClient({    
      chain: base,    
      transport: custom((window as any).ethereum),    
    }).extend(publicActions)    
        
    // 获取当前账户    
    const accounts = await baseClient.getAddresses()    
    if (!accounts || accounts.length === 0) {    
      throw new Error('未找到连接的账户')    
    }  
      
    return createWalletClient({  
      chain: base,  
      transport: custom((window as any).ethereum),  
      account: accounts[0],  
    }).extend(publicActions);  
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
  
export function Welcome() {  
  const [client, setClient] = useState<X402MetaMaskClient | null>(null);  
  const [account, setAccount] = useState<string | null>(null);  
  const [loading, setLoading] = useState(false);  
  const [error, setError] = useState<string | null>(null);  
  const [weatherData, setWeatherData] = useState<any>(null);  
  const [paymentInfo, setPaymentInfo] = useState<any>(null);  
  
  // 连接并初始化钱包  
  const connectAndInit = async () => {  
    setError(null);  
    setLoading(true);  
    try {  
      const c = new X402MetaMaskClient();  
      await c.initialize();  
      setClient(c);  
      setAccount(c.address);  
      setError(null);  
    } catch (e: any) {  
      setError(e.message || "连接失败");  
    } finally {  
      setLoading(false);  
    }  
  };  
  
  // 断开连接  
  const disconnect = () => {  
    setClient(null);  
    setAccount(null);  
    setWeatherData(null);  
    setPaymentInfo(null);  
    setError(null);  
  };  
  
  // 查询天气  
  const fetchWeatherData = async () => {  
    if (!client) {  
      setError("请先连接钱包");  
      return;  
    }  
    setLoading(true);  
    setError(null);  
    setPaymentInfo(null);  
    try {  
      const response = await client.httpClient!.get("/item2");  
      setWeatherData(response.data);  
      console.log("x-payment-response", response.headers["x-payment-response"]);
      if (response.headers["x-payment-response"]) {  
        const paymentResponse = decodeXPaymentResponse(response.headers["x-payment-response"]); 
        console.log("paymentResponse", paymentResponse);
        setPaymentInfo(paymentResponse);  
      }  
    } catch (err: any) {  
      setError(err.message || "获取天气失败");  
    } finally {  
      setLoading(false);  
    }  
  };  
  
  return (  
    <main className="flex items-center justify-center pt-16 pb-4">  
      <div className="flex-1 flex flex-col items-center gap-16 min-h-0">  
        <button  
          onClick={connectAndInit}  
          className="px-4 py-2 bg-orange-500 text-white rounded-lg mb-4"  
          disabled={loading || !!client}  
        >  
          连接并初始化MetaMask  
        </button>  
        {account && (  
          <div className="p-2 bg-blue-50 border border-blue-100 rounded-lg w-full text-center">  
            <p className="text-xs text-blue-700">  
              钱包地址: {`${account.slice(0, 6)}...${account.slice(-4)}`}  
            </p>  
            <button  
              onClick={disconnect}  
              className="ml-4 px-2 py-1 bg-gray-300 text-gray-700 rounded"  
            >  
              断开连接  
            </button>  
          </div>  
        )}  
        <button  
          onClick={fetchWeatherData}  
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"  
          disabled={loading || !client}  
        >  
          {loading ? "加载中..." : "查询天气"}  
        </button>  
        {error && <p className="text-red-500">{error}</p>}  
        {weatherData && (  
          <div className="mt-4 p-4 border rounded-lg w-full">  
            <h3 className="font-bold text-center mb-2">天气信息</h3>  
            <pre className="whitespace-pre-wrap overflow-auto">  
              {JSON.stringify(weatherData, null, 2)}  
            </pre>  
          </div>  
        )}  
        {paymentInfo && (  
          <div className="mt-4 p-4 border border-green-200 rounded-lg w-full bg-green-50">  
            <h3 className="font-bold text-center mb-2">支付信息</h3>  
            <div className="text-sm">  
              <p>支付状态: {paymentInfo.success ? "成功" : "失败"}</p>  
              <p>交易哈希: {paymentInfo.transaction}</p>  
              <p>网络: {paymentInfo.network}</p>  
              <p>付款方地址: {paymentInfo.payer}</p>  
            </div>  
          </div>  
        )}  
      </div>  
    </main>  
  );  
}