import { type RouteConfig, index } from "@react-router/dev/routes";

// 只保留首页路由
export default [index("routes/home.tsx")] satisfies RouteConfig;
