import { useState } from "react";  
import axios, { type AxiosInstance } from "axios";  
import { withPaymentInterceptor, decodeXPaymentResponse } from "x402-axios";
import { privateKeyToAccount } from "viem/accounts";
// Frontend calls our backend (cdp.py FastAPI)
  
class X402Client {  
  public httpClient: AxiosInstance | null = null;  
  public address: string | null = null;  

  async initialize() {  
    // 只获取地址，不获取私钥
    const { data } = await axios.post("/api/cdp/accounts/import", {});
    this.address = data.address;
    
    // 使用普通的 axios 实例，调用后端代理
    this.httpClient = axios.create({ 
      baseURL: "/api/x402", // 调用后端代理
      timeout: 30000 
    });
  }  
}  
  
export function Welcome() {  
  const [client, setClient] = useState<X402Client | null>(null);  
  const [account, setAccount] = useState<string | null>(null);  
  const [loading, setLoading] = useState(false);  
  const [error, setError] = useState<string | null>(null);  
  const [weatherData, setWeatherData] = useState<any>(null);  
  const [paymentInfo, setPaymentInfo] = useState<any>(null);  
  const [exportAddress, setExportAddress] = useState<string>("");  
  const [exportedKey, setExportedKey] = useState<{ private_key_hex?: string; private_key_hex_prefixed?: string } | null>(null);  
  
  // 连接并初始化钱包  
  const connectAndInit = async () => {  
    setError(null);  
    setLoading(true);  
    try {  
      const c = new X402Client();  
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
  
  // 直接请求 x402 付费 API（前端使用私钥签名）
  const fetchWeatherData = async () => {  
    if (!client || !client.httpClient) {  
      setError("请先连接钱包");  
      return;  
    }  
    setLoading(true);  
    setError(null);  
    setPaymentInfo(null);  
      try {  
    // 调用后端代理，后端使用私钥处理 x402 请求
    const response = await client.httpClient.get("/item1");
    
    // 处理响应数据
    if (response.data.data) {
      setWeatherData(response.data.data);
    }
    
    // 处理支付响应头
    const xpr = response.data.x_payment_response;
    if (xpr) {
      try {
        const pr = decodeXPaymentResponse(xpr);
        setPaymentInfo(pr);
      } catch {
        setPaymentInfo(null);
      }
    }
  } catch (err: any) {  
    setError(err.message || "获取失败");  
  } finally {  
    setLoading(false);  
  }  
  };  
  
  // 导出已有地址的私钥（后端导出）  
  const exportPrivateKey = async () => {  
    if (!exportAddress) {  
      setError("请输入地址");  
      return;  
    }  
    setLoading(true);  
    setError(null);  
    setExportedKey(null);  
    try {  
      const resp = await axios.post("/api/cdp/accounts/export", { address: exportAddress });  
      setExportedKey(resp.data);  
    } catch (e: any) {  
      setError(e?.response?.data?.detail || e.message || "导出失败");  
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
          连接后端钱包  
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
          {loading ? "加载中..." : "查询 item1（付费）"}  
        </button>  
        <div className="w-full flex items-center gap-2">  
          <input  
            value={exportAddress}  
            onChange={e => setExportAddress(e.target.value)}  
            placeholder="输入要导出的地址 0x..."  
            className="flex-1 px-3 py-2 border rounded"  
          />  
          <button  
            onClick={exportPrivateKey}  
            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"  
            disabled={loading}  
          >  
            导出私钥  
          </button>  
        </div>  
        {error && <p className="text-red-500">{error}</p>}  
        {weatherData && (  
          <div className="mt-4 p-4 border rounded-lg w-full">  
            <h3 className="font-bold text-center mb-2">天气信息</h3>  
            <pre className="whitespace-pre-wrap overflow-auto">  
              {JSON.stringify(weatherData, null, 2)}  
            </pre>  
          </div>  
        )}  
        {exportedKey && (  
          <div className="mt-4 p-4 border border-yellow-200 rounded-lg w-full bg-green-50">  
            <h3 className="font-bold text-center mb-2">导出的私钥（请妥善保管）</h3>  
            <div className="text-sm break-all">  
              <p>private_key_hex: {exportedKey.private_key_hex}</p>  
              <p>private_key_hex_prefixed: {exportedKey.private_key_hex_prefixed}</p>  
            </div>  
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