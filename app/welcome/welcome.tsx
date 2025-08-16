import { useState } from "react";  
import axios, { type AxiosInstance } from "axios";  
import { withPaymentInterceptor, decodeXPaymentResponse } from "x402-axios";
import { privateKeyToAccount } from "viem/accounts";
// Frontend calls our backend (cdp.py FastAPI)

// MetaMask 类型声明
declare global {
  interface Window {
    ethereum?: any;
  }
}

// EIP-2612 相关常量 - Base 网络 USDC
const BASE_USDC_CONFIG = {
  chainId: 8453, // Base mainnet
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
  usdcName: "USD Coin",
  usdcVersion: "1"
};

// EIP-2612 Permit 类型哈希
const PERMIT_TYPEHASH = "0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9";

// 检查是否安装了 MetaMask
const checkMetaMask = () => {
  if (typeof window !== 'undefined' && (window as any).ethereum) {
    return (window as any).ethereum;
  }
  return null;
};

// 检查是否在 Base 网络
const checkBaseNetwork = async (ethereum: any) => {
  try {
    const chainId = await ethereum.request({ method: 'eth_chainId' });
    return chainId === '0x2105'; // Base mainnet chainId in hex
  } catch (error) {
    return false;
  }
};

// 切换到 Base 网络
const switchToBaseNetwork = async (ethereum: any) => {
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }], // Base mainnet
    });
    return true;
  } catch (switchError: any) {
    // 如果网络不存在，尝试添加网络
    if (switchError.code === 4902) {
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x2105',
            chainName: 'Base',
            nativeCurrency: {
              name: 'ETH',
              symbol: 'ETH',
              decimals: 18,
            },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org'],
          }],
        });
        return true;
      } catch (addError) {
        return false;
      }
    }
    return false;
  }
};

// 获取域名分隔符
const getDomainSeparator = (contractAddress: string, chainId: number) => {
  const domain = {
    name: BASE_USDC_CONFIG.usdcName,
    version: BASE_USDC_CONFIG.usdcVersion,
    chainId: chainId,
    verifyingContract: contractAddress,
  };
  
  const domainType = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
  };
  
  return { domain, domainType };
};

// 获取 Permit 类型
const getPermitType = () => {
  return {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
};
  
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
  
  // 新增：MetaMask EIP-2612 相关状态
  const [metamaskAccount, setMetamaskAccount] = useState<string | null>(null);
  const [metamaskLoading, setMetamaskLoading] = useState(false);
  const [metamaskError, setMetamaskError] = useState<string | null>(null);
  const [permitSignature, setPermitSignature] = useState<any>(null);
  const [permitParams, setPermitParams] = useState({
    spender: "",
    value: "1000000", // 1 USDC (6位小数)
    deadline: Math.floor(Date.now() / 1000) + 3600 // 1小时后过期
  });

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

  // 新增：连接 MetaMask
  const connectMetaMask = async () => {
    const ethereum = checkMetaMask();
    if (!ethereum) {
      setMetamaskError("请先安装 MetaMask");
      return;
    }

    setMetamaskLoading(true);
    setMetamaskError(null);

    try {
      // 请求账户连接
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts[0];
      setMetamaskAccount(account);

      // 检查并切换到 Base 网络
      const isBaseNetwork = await checkBaseNetwork(ethereum);
      if (!isBaseNetwork) {
        const switched = await switchToBaseNetwork(ethereum);
        if (!switched) {
          setMetamaskError("无法切换到 Base 网络");
          return;
        }
      }

      setMetamaskError(null);
    } catch (error: any) {
      setMetamaskError(error.message || "连接 MetaMask 失败");
    } finally {
      setMetamaskLoading(false);
    }
  };

  // 新增：断开 MetaMask 连接
  const disconnectMetaMask = () => {
    setMetamaskAccount(null);
    setPermitSignature(null);
    setMetamaskError(null);
  };

  // 新增：执行 EIP-2612 Permit 签名
  const executePermitSignature = async () => {
    if (!metamaskAccount || !permitParams.spender || !permitParams.value) {
      setMetamaskError("请填写完整信息");
      return;
    }

    const ethereum = checkMetaMask();
    if (!ethereum) {
      setMetamaskError("MetaMask 未连接");
      return;
    }

    setMetamaskLoading(true);
    setMetamaskError(null);
    setPermitSignature(null);

    try {
      // 获取当前 nonce（这里简化处理，实际应该从合约获取）
      const nonce = 0; // 简化处理，实际应该调用合约的 nonces 函数
      
      // 获取当前网络 chainId
      const chainId = await ethereum.request({ method: 'eth_chainId' });
      const chainIdNumber = parseInt(chainId, 16);

      // 准备签名数据
      const domain = getDomainSeparator(BASE_USDC_CONFIG.usdcAddress, chainIdNumber);
      const types = getPermitType();
      const message = {
        owner: metamaskAccount,
        spender: permitParams.spender,
        value: permitParams.value,
        nonce: nonce,
        deadline: permitParams.deadline,
      };

      // 使用 MetaMask 签名
      const signature = await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [metamaskAccount, JSON.stringify({
          types: { ...types, ...domain.domainType },
          primaryType: 'Permit',
          domain: domain.domain,
          message: message,
        })],
      });

      // 解析签名
      const r = signature.slice(0, 66);
      const s = '0x' + signature.slice(66, 130);
      const v = parseInt(signature.slice(130, 132), 16);

      setPermitSignature({
        owner: metamaskAccount,
        spender: permitParams.spender,
        value: permitParams.value,
        nonce: nonce,
        deadline: permitParams.deadline,
        signature: signature,
        r: r,
        s: s,
        v: v,
        message: `已为地址 ${permitParams.spender} 创建 permit 授权，金额: ${parseInt(permitParams.value) / 1000000} USDC`
      });

    } catch (error: any) {
      setMetamaskError(error.message || "Permit 签名失败");
    } finally {
      setMetamaskLoading(false);
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

        {/* 新增：MetaMask EIP-2612 Permit 功能区域 - 完全独立 */}
        <div className="w-full p-4 border border-green-200 rounded-lg bg-green-50">
          <h3 className="font-bold text-center mb-4 text-green-800">MetaMask EIP-2612 Permit 功能 (Base USDC)</h3>
          
          {/* MetaMask 连接状态 */}
          {!metamaskAccount ? (
            <button
              onClick={connectMetaMask}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400"
              disabled={metamaskLoading}
            >
              {metamaskLoading ? "连接中..." : "连接 MetaMask"}
            </button>
          ) : (
            <div className="mb-4 p-3 bg-white rounded border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">MetaMask 地址:</span>
                <span className="font-mono text-sm">
                  {`${metamaskAccount.slice(0, 6)}...${metamaskAccount.slice(-4)}`}
                </span>
                <button
                  onClick={disconnectMetaMask}
                  className="px-2 py-1 bg-red-200 text-red-700 rounded text-xs hover:bg-red-300"
                >
                  断开
                </button>
              </div>
            </div>
          )}

          {/* Permit 参数输入 - 仅在连接 MetaMask 后显示 */}
          {metamaskAccount && (
            <>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">授权地址 (Spender):</label>
                  <input
                    value={permitParams.spender}
                    onChange={e => setPermitParams(prev => ({ ...prev, spender: e.target.value }))}
                    placeholder="0x..."
                    className="w-full px-3 py-2 border rounded text-sm"
                  />
                </div>
                
                <div>
                  <label className="text-sm text-gray-600 mb-1">授权金额 (USDC):</label>
                  <input
                    type="number"
                    value={parseInt(permitParams.value) / 1000000}
                    onChange={e => setPermitParams(prev => ({ 
                      ...prev, 
                      value: Math.floor(parseFloat(e.target.value || "0") * 1000000).toString() 
                    }))}
                    placeholder="1.0"
                    step="0.000001"
                    className="w-full px-3 py-2 border rounded text-sm"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600 mb-1">过期时间 (秒):</label>
                  <input
                    type="number"
                    value={permitParams.deadline - Math.floor(Date.now() / 1000)}
                    onChange={e => setPermitParams(prev => ({ 
                      ...prev, 
                      deadline: Math.floor(Date.now() / 1000) + parseInt(e.target.value || "0") 
                    }))}
                    placeholder="3600"
                    className="w-full px-3 py-2 border rounded text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    过期时间: {new Date(permitParams.deadline * 1000).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Execute Permit 按钮 */}
              <button
                onClick={executePermitSignature}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400"
                disabled={metamaskLoading || !permitParams.spender || !permitParams.value}
              >
                {metamaskLoading ? "处理中..." : "执行 EIP-2612 Permit 签名"}
              </button>
            </>
          )}

          {/* Permit 签名结果显示 */}
          {permitSignature && (
            <div className="mt-4 p-3 bg-white rounded border">
              <h4 className="font-semibold text-sm mb-2 text-green-800">Permit 签名成功:</h4>
              <p className="text-sm text-gray-700 mb-2">{permitSignature.message}</p>
              <div className="text-xs text-gray-600 space-y-1">
                <p>Owner: {`${permitSignature.owner.slice(0, 6)}...${permitSignature.owner.slice(-4)}`}</p>
                <p>Spender: {`${permitSignature.spender.slice(0, 6)}...${permitSignature.spender.slice(-4)}`}</p>
                <p>Value: {parseInt(permitSignature.value) / 1000000} USDC</p>
                <p>Nonce: {permitSignature.nonce}</p>
                <p>Deadline: {new Date(permitSignature.deadline * 1000).toLocaleString()}</p>
                <p>Signature v: {permitSignature.v}</p>
                <p>Signature r: {`${permitSignature.r.slice(0, 10)}...`}</p>
                <p>Signature s: {`${permitSignature.s.slice(0, 10)}...`}</p>
                <p className="text-xs text-green-600 mt-2">
                  完整签名: {permitSignature.signature}
                </p>
              </div>
            </div>
          )}

          {/* MetaMask 错误显示 */}
          {metamaskError && (
            <div className="mt-4 p-3 bg-red-100 border border-red-200 rounded">
              <p className="text-sm text-red-700">{metamaskError}</p>
            </div>
          )}
        </div>

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