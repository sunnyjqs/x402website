import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  
  // 开发工具配置
  devtools: {
    // 忽略某些路径的警告
    ignoreRouteWarnings: [
      "/.well-known/appspecific/*"
    ]
  },
} satisfies Config;
