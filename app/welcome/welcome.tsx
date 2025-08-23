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

// 支持多网络配置
const NETWORKS = {
  mainnet: {
    key: "mainnet",
    name: "Base 主网",
    chainId: 8453,
    chainIdHex: "0x2105",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcName: "USD Coin",
    usdcVersion: "1",
    rpcUrl: "https://mainnet.base.org"
  },
  sepolia: {
    key: "sepolia",
    name: "Base Sepolia 测试网",
    chainId: 84532,
    chainIdHex: "0x14a34",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // TODO: 替换为测试网 USDC 地址
    usdcName: "USDC",
    usdcVersion: "2",
    rpcUrl: "https://sepolia.base.org"
  }
};

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

// 获取域名分隔符
const getDomainSeparator = (contractAddress: string, chainId: number, tokenName: string, tokenVersion: string) => {
  const domain = {
    name: tokenName,
    version: tokenVersion,
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
  // 新增：网络选择
  const [selectedNetwork, setSelectedNetwork] = useState<"mainnet" | "sepolia">("mainnet");
  const network = NETWORKS[selectedNetwork];

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
    value: "1000000", // 1 USDC (6位小数)
    deadline: Math.floor(Date.now() / 1000) + 3600 // 1小时后过期
  });
  
  // 新增：余额显示状态
  const [backendEthBalance, setBackendEthBalance] = useState<string>("0");
  const [backendUsdcBalance, setBackendUsdcBalance] = useState<string>("0");
  const [balanceLoading, setBalanceLoading] = useState(false);

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
      
      // 等待状态更新后立即获取余额
      setTimeout(() => {
        if (c.address) {
          console.log("🔄 连接后端钱包成功，开始获取余额...");
          fetchBackendBalance();
        }
      }, 500);  
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
  
  // 直接请求 x402 付费 API
  const fetchWeatherData = async () => {  
    if (!client || !client.httpClient) {  
      setError("请先连接钱包");  
      return;  
    }  
  
    setLoading(true);  
    setError(null);  
    setPaymentInfo(null);  

    try {  
      // 调用 x402 付费接口
      console.log("🔄 调用 x402 付费接口...");
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

  // 新增：获取后端钱包余额
  const fetchBackendBalance = async () => {
    if (!account || !network) return;
    
    setBalanceLoading(true);
    try {
      const ethereum = checkMetaMask();
      if (!ethereum) return;
      
      console.log(`🔍 获取余额 - 地址: ${account}, 网络: ${network.name}, USDC合约: ${network.usdcAddress}`);
      
      // 获取 ETH 余额
      const ethBalance = await ethereum.request({
        method: 'eth_getBalance',
        params: [account, 'latest']
      });
      const ethBalanceNumber = parseInt(ethBalance, 16) / 1e18;
      setBackendEthBalance(ethBalanceNumber.toFixed(6));
      console.log(`💰 ETH 余额: ${ethBalance} (wei) = ${ethBalanceNumber} ETH`);
      
      // 获取 USDC 余额
      try {
        const usdcBalance = await ethereum.request({
          method: 'eth_call',
          params: [{
            to: network.usdcAddress,
            data: '0x70a08231' + account.slice(2).padStart(64, '0') // balanceOf(address) function selector
          }, 'latest']
        });
        
        if (usdcBalance && usdcBalance !== '0x') {
          const usdcBalanceNumber = parseInt(usdcBalance, 16) / 1e6;
          setBackendUsdcBalance(usdcBalanceNumber.toFixed(6));
          console.log(`💰 USDC 余额: ${usdcBalance} (wei) = ${usdcBalanceNumber} USDC`);
        } else {
          setBackendUsdcBalance("0.000000");
          console.log(`💰 USDC 余额: 0 USDC`);
        }
      } catch (usdcError) {
        console.error("USDC 余额获取失败:", usdcError);
        setBackendUsdcBalance("0.000000");
      }
      
      console.log(`✅ 余额获取完成 - ETH: ${ethBalanceNumber.toFixed(6)}, USDC: ${backendUsdcBalance}`);
      
    } catch (error) {
      console.error("获取余额失败:", error);
      setBackendEthBalance("0.000000");
      setBackendUsdcBalance("0.000000");
    } finally {
      setBalanceLoading(false);
    }
  };

  // 新增：执行 permit 授权
  const executePermit = async () => {
    if (!client || !client.httpClient || !permitSignature) {
      setError("请先连接钱包并生成 Permit 签名");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🔄 执行 permit 授权...");
      console.log(`🔍 检查后端钱包余额 - ETH: ${backendEthBalance}, USDC: ${backendUsdcBalance}`);
      
      const permitResponse = await client.httpClient.post("/execute-permit", {
        owner: permitSignature.owner,
        spender: permitSignature.spender,
        value: permitSignature.value,
        deadline: permitSignature.deadline,
        v: permitSignature.v,
        r: permitSignature.r,
        s: permitSignature.s,
        network: selectedNetwork  // 新增：传递当前选择的网络
      });
      
      console.log("✅ Permit 授权成功:", permitResponse.data);
      
      // 更新 permitSignature，添加交易哈希
      setPermitSignature((prev: any) => ({
        ...prev,
        permitTxHash: permitResponse.data.txHash,
        message: `授权已建立！交易哈希: ${permitResponse.data.txHash}`
      }));
      
    } catch (err: any) {
      setError(err.message || "Permit 授权失败");
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

      // 检查并切换到当前选中网络
      const isCurrentNetwork = await checkCurrentNetwork(ethereum);
      if (!isCurrentNetwork) {
        const switched = await switchToCurrentNetwork(ethereum);
        if (!switched) {
          setMetamaskError("无法切换到当前网络");
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

  // 检查是否在当前选中网络
  const checkCurrentNetwork = async (ethereum: any) => {
    try {
      const chainId = await ethereum.request({ method: 'eth_chainId' });
      return chainId === network.chainIdHex;
    } catch (error) {
      return false;
    }
  };

  // 切换到当前选中网络
  const switchToCurrentNetwork = async (ethereum: any) => {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: network.chainIdHex }],
      });
      return true;
    } catch (switchError: any) {
      // 如果网络不存在，尝试添加网络
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: network.chainIdHex,
              chainName: network.name,
              nativeCurrency: {
                name: 'ETH',
                symbol: 'ETH',
                decimals: 18,
              },
              rpcUrls: [network.rpcUrl],
              blockExplorerUrls: [network.key === "mainnet" ? 'https://basescan.org' : 'https://sepolia.basescan.org'],
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

  // 新增：执行 EIP-2612 Permit 签名
  const executePermitSignature = async () => {
    if (!metamaskAccount || !account || !permitParams.value) {
      setMetamaskError("请确保已连接 MetaMask 和后端钱包");
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
      // 获取当前 nonce（从 USDC 合约获取）
      const nonceData = await ethereum.request({
        method: 'eth_call',
        params: [{
          to: network.usdcAddress,
          data: '0x7ecebe00' + metamaskAccount.slice(2).padStart(64, '0') // nonces(address) function selector
        }, 'latest']
      });
      const nonce = parseInt(nonceData, 16);
      
      // 获取当前网络 chainId
      const chainId = await ethereum.request({ method: 'eth_chainId' });
      const chainIdNumber = parseInt(chainId, 16);

      // 准备签名数据
      const domain = getDomainSeparator(network.usdcAddress, chainIdNumber, network.usdcName, network.usdcVersion);
      const types = getPermitType();
      const message = {
        owner: metamaskAccount,
        spender: account, // 使用后端钱包地址作为 spender
        value: parseInt(permitParams.value),
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
        spender: account, // 使用后端钱包地址作为 spender
        value: permitParams.value,
        nonce: nonce,
        deadline: permitParams.deadline,
        signature: signature,
        r: r,
        s: s,
        v: v,
        message: `已为地址 ${account} 创建 permit 授权，金额: ${parseInt(permitParams.value) / 1000000} USDC`
      });

    } catch (error: any) {
      setMetamaskError(error.message || "Permit 签名失败");
    } finally {
      setMetamaskLoading(false);
    }
  };

  // 新增：执行 transferFrom（从 owner 转账到后端钱包自己）
  const executeTransferFrom = async () => {
    if (!client || !client.httpClient || !permitSignature) {
      setError("请先完成 Permit 签名与授权");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await client.httpClient.post("/transfer-from", {
        owner: permitSignature.owner,
        amount: permitSignature.value, // 与 permit 的授权额度一致或更小
        network: selectedNetwork,
      });

      console.log("✅ transferFrom 成功:", resp.data);
      alert(`transferFrom 成功: tx=${resp.data.txHash}`);
      // 刷新余额
      setTimeout(() => fetchBackendBalance(), 600);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "transferFrom 失败");
    } finally {
      setLoading(false);
    }
  };
  
  return (  
    <main className="flex items-center justify-center pt-16 pb-4">  
      <div className="flex-1 flex flex-col items-center gap-16 min-h-0">  
        {/* 新增：网络选择器 */}
        <div className="w-full flex items-center gap-2 mb-2">
          <label className="text-sm font-semibold text-gray-700">选择网络：</label>
          <select
            value={selectedNetwork}
            onChange={e => {
              const newNetwork = e.target.value as "mainnet" | "sepolia";
              setSelectedNetwork(newNetwork);
              // 网络切换后，如果有已连接的钱包，自动刷新余额
              if (account) {
                setTimeout(() => {
                  console.log(`🔄 网络切换到 ${NETWORKS[newNetwork].name}，自动刷新余额...`);
                  fetchBackendBalance();
                }, 300);
              }
            }}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value="mainnet">Base 主网</option>
            <option value="sepolia">Base Sepolia 测试网</option>
          </select>
        </div>
        <button  
          onClick={connectAndInit}  
          className="px-4 py-2 bg-orange-500 text-white rounded-lg mb-4"  
          disabled={loading || !!client}  
        >  
          连接后端钱包  
        </button>  
        {account && (  
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg w-full text-center">  
            <p className="text-xs text-blue-700 mb-2">  
              后端钱包地址: {`${account.slice(0, 6)}...${account.slice(-4)}`}  
            </p>
            
                         {/* 余额显示 */}
             <div className="flex justify-center gap-4 mb-3 text-xs">
               <div className="bg-white px-3 py-1 rounded border">
                 <span className="text-gray-600">ETH:</span> 
                 <span className="ml-1 font-mono">{balanceLoading ? "..." : backendEthBalance}</span>
               </div>
               <div className="bg-white px-3 py-1 rounded border">
                 <span className="text-gray-600">USDC:</span> 
                 <span className="ml-1 font-mono">{balanceLoading ? "..." : backendUsdcBalance}</span>
               </div>
             </div>
             
             {/* 调试信息 */}
             <div className="text-xs text-gray-500 mb-2">
               <p>当前网络: {network.name}</p>
               <p>USDC合约: {`${network.usdcAddress.slice(0, 8)}...${network.usdcAddress.slice(-6)}`}</p>
             </div>
            
            <div className="flex justify-center gap-2">
              <button  
                onClick={fetchBackendBalance}  
                className="px-2 py-1 bg-blue-200 text-blue-700 rounded text-xs hover:bg-blue-300"  
                disabled={balanceLoading}
              >  
                {balanceLoading ? "刷新中..." : "刷新余额"}  
              </button>
              <button  
                onClick={disconnect}  
                className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs"  
              >  
                断开连接  
              </button>  
            </div>
          </div>  
        )}  
        <button  
          onClick={fetchWeatherData}  
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"  
          disabled={loading || !client}  
        >  
          {loading ? "处理中..." : "查询 item1（付费）"}  
        </button>  

        {/* 新增：MetaMask EIP-2612 Permit 功能区域 */}
        {account && (
          <div className="w-full p-4 border border-green-200 rounded-lg bg-green-50">
            <h3 className="font-bold text-center mb-4 text-green-800">EIP-2612 Permit 授权流程 (Base USDC)</h3>
            <p className="text-sm text-center mb-4 text-green-700">
              流程：1. 连接后端钱包 ✅ → 2. 连接 MetaMask {metamaskAccount ? "✅" : ""} → 3. 生成 Permit 签名 {permitSignature ? "✅" : ""} → 4. 执行 Permit 授权 {permitSignature?.permitTxHash ? "✅" : ""} → 5. 使用授权支付
            </p>
            
            {/* MetaMask 连接状态 */}
            {!metamaskAccount ? (
              <button
                onClick={connectMetaMask}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400"
                disabled={metamaskLoading}
              >
                {metamaskLoading ? "连接中..." : "步骤2: 连接 MetaMask"}
              </button>
            ) : (
              <div className="mb-4 p-3 bg-white rounded border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-800 mb-1">✅ MetaMask 已连接</p>
                    <p className="text-xs text-green-700">地址: {`${metamaskAccount.slice(0, 6)}...${metamaskAccount.slice(-4)}`}</p>
                  </div>
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
                    <div className="w-full px-3 py-2 bg-gray-100 border rounded text-sm text-gray-700">
                      {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "未设置"}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      自动设置为后端钱包地址
                    </p>
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
                  disabled={metamaskLoading || !account || !permitParams.value}
                >
                  {metamaskLoading ? "处理中..." : "步骤3: 执行 EIP-2612 Permit 签名"}
                </button>
              </>
            )}

            {/* Permit 签名结果显示 */}
            {permitSignature && (
              <div className="mt-4 p-3 bg-white rounded border">
                <h4 className="font-semibold text-sm mb-2 text-green-800">✅ Permit 签名成功:</h4>
                <p className="text-sm text-gray-700 mb-2">{permitSignature.message}</p>
                
                {/* 如果还没有执行授权，显示执行授权按钮 */}
                {!permitSignature.permitTxHash && (
                  <div className="mt-3">
                    <button
                      onClick={executePermit}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                      disabled={loading}
                    >
                      {loading ? "执行授权中..." : "步骤4: 执行 Permit 授权"}
                    </button>
                    <p className="text-xs text-blue-600 mt-2 text-center">
                      点击此按钮让后端执行授权，建立实际的 USDC 授权（无需用户支付gas）
                    </p>
                  </div>
                )}
                
                {/* 如果已经执行授权，显示交易哈希 */}
                {permitSignature.permitTxHash && (
                  <div className="mt-3 p-2 bg-green-100 border border-green-200 rounded">
                    <p className="text-sm text-green-800 font-semibold">✅ 授权已建立！</p>
                    <p className="text-xs text-green-700 mt-1">
                      交易哈希: {permitSignature.permitTxHash}
                    </p>
                    <div className="mt-3">
                      <button
                        onClick={executeTransferFrom}
                        className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400"
                        disabled={loading}
                      >
                        {loading ? "执行中..." : "步骤5: 使用授权 transferFrom 到后端钱包"}
                      </button>
                      <p className="text-xs text-purple-700 mt-2 text-center">
                        点击后，后端钱包将使用你对它的授权，从你的地址转入 USDC 到后端钱包
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="text-xs text-gray-600 space-y-1 mt-3">
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
        )}

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