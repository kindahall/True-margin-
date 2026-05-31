import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bell,
  Box,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  DollarSign,
  Download,
  Gauge,
  Home,
  KeyRound,
  PackageSearch,
  Plug,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Trash2,
  Truck,
  XCircle
} from "lucide-react";
import { calculateScout, parseMoneyInput, parsePercentInput, type ScoutCalculation } from "./scout-calculation";
import "./styles.css";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4001";
const purchaseUrl = import.meta.env.VITE_PURCHASE_URL ?? "";

type View = "dashboard" | "scout" | "products" | "product" | "orders" | "alerts" | "costs" | "integrations" | "settings" | "billing";
type MarginStatus = "profitable" | "warning" | "loss" | "unknown";
type ChannelFilter = "all" | ProductSummary["channel"];
type StatusFilter = "all" | MarginStatus;
type ScoutState = "idle" | "loading" | "ready" | "error";
type IntegrationName = "Shopify" | "WooCommerce" | "WordPress" | "Stripe" | "PayPal" | "Meta Ads" | "TikTok Ads" | "Google Ads" | "Shipping Rules" | "Manual Imports";
type IntegrationStatus = "Ready" | "Needs setup";
type PlanName = "Starter" | "Growth" | "Pro";

const viewNames: View[] = ["dashboard", "scout", "products", "product", "orders", "alerts", "costs", "integrations", "settings", "billing"];
const integrationOrder: IntegrationName[] = ["Shopify", "WooCommerce", "WordPress", "Stripe", "PayPal", "Meta Ads", "TikTok Ads", "Google Ads", "Shipping Rules", "Manual Imports"];

interface ProductSummary {
  id: string;
  title: string;
  sku: string;
  channel: "Shopify" | "WooCommerce" | "WordPress";
  image: string;
  unitsSold: number;
  adCostMinor: number;
  shippingCostMinor: number;
  feesMinor: number;
  returnsMinor: number;
  margin: {
    revenueNetMinor: number;
    variableCostsMinor: number;
    trueMarginMinor: number;
    trueMarginPercent: number | null;
    breakEvenCpaMinor: number;
    status: MarginStatus;
    missingCosts: string[];
    costs: Array<{
      key: string;
      amountMinor: number;
    }>;
  };
}

interface AlertEvent {
  id: string;
  productId: string;
  title: string;
  severity: "loss" | "warning" | "unknown";
  message: string;
  suggestedAction: string;
  updatedMinutesAgo: number;
}

interface OverviewPayload {
  metrics: {
    revenueMinor: number;
    realMarginMinor: number;
    adCostMinor: number;
    shippingCostMinor: number;
    returnCostMinor: number;
    feesMinor: number;
    unprofitableProducts: number;
    averageMarginPercent: number | null;
    currency: string;
  };
  topProducts: ProductSummary[];
  alerts: AlertEvent[];
}

interface ScoutProductResult {
  url: string;
  host: string;
  title: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string | null;
  source: "json-ld" | "meta" | "html";
}

interface ScoutMarketMatch {
  title: string;
  url: string;
  host: string;
  priceMinor: number;
  currency: string;
  imageUrl: string | null;
  source: string;
}

interface ScoutMarketResult {
  status: "ready" | "not_configured" | "not_found" | "error";
  provider: string | null;
  matches: ScoutMarketMatch[];
  lowest: ScoutMarketMatch | null;
  error?: string;
}

interface IntegrationItem {
  name: IntegrationName;
  status: IntegrationStatus;
  code: string;
  endpoint: string;
  token: string;
  signingSecret?: string;
}

interface WorkspaceSettings {
  storeName: string;
  currency: string;
  taxMode: string;
  language: string;
  alertLoss: boolean;
  alertCosts: boolean;
  alertReturns: boolean;
  alertEmail: boolean;
}

interface CostRules {
  shippingFallback: string;
  returnShipping: string;
  packagingCost: string;
  taxMode: string;
  importedRows: number;
}

interface BillingState {
  plan: PlanName;
  billingEmail: string;
  licenseKey: string;
  licenseStatus: "Inactive" | "Active";
  licenseId: string;
}

interface ActivityItem {
  id: string;
  label: string;
  status: string;
  at: string;
}

interface OrderSummary {
  id: string;
  sourceOrderId: string;
  channel: "Shopify" | "WooCommerce";
  customer: string;
  placedAt: string;
  productIds?: string[];
  revenueMinor: number;
  trueMarginMinor: number;
  trueMarginPercent: number | null;
  status: MarginStatus;
}

interface StoreSummary {
  id: string;
  platform: "shopify" | "woocommerce" | "wordpress";
  status: "connected";
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: "owner" | "admin" | "member";
  tenantId: string;
  workspaceName: string;
  plan?: PlanName;
  licenseActive?: boolean;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

interface TeamPayload {
  allowed: boolean;
  plan: PlanName;
  members: TeamMember[];
  error?: string;
}

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiKeyPayload {
  allowed: boolean;
  plan: PlanName;
  keys: ApiKeySummary[];
  error?: string;
}

const emptyOverview: OverviewPayload = {
  metrics: {
    revenueMinor: 0,
    realMarginMinor: 0,
    adCostMinor: 0,
    shippingCostMinor: 0,
    returnCostMinor: 0,
    feesMinor: 0,
    unprofitableProducts: 0,
    averageMarginPercent: null,
    currency: "USD"
  },
  topProducts: [],
  alerts: []
};

const defaultIntegrations: IntegrationItem[] = integrationOrder.map((name) => ({
  name,
  status: "Needs setup",
  code: name === "Shipping Rules" ? "SR" : name === "Manual Imports" ? "MI" : name === "WordPress" ? "WP" : name.split(" ").map((part) => part[0]).join("").slice(0, 2),
  endpoint: "",
  token: ""
}));

const defaultWorkspaceSettings: WorkspaceSettings = {
  storeName: "",
  currency: "",
  taxMode: "",
  language: "English",
  alertLoss: false,
  alertCosts: false,
  alertReturns: false,
  alertEmail: false
};

const defaultCostRules: CostRules = {
  shippingFallback: "",
  returnShipping: "",
  packagingCost: "",
  taxMode: "",
  importedRows: 0
};

const defaultBilling: BillingState = {
  plan: "Starter",
  billingEmail: "",
  licenseKey: "",
  licenseStatus: "Inactive",
  licenseId: ""
};

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    const merged = { ...fallback, ...parsed };
    if (key === "tmt.billing") {
      const billing = merged as BillingState;
      return {
        ...billing,
        plan: billing.licenseStatus === "Active" ? billing.plan : (fallback as BillingState).plan
      } as T;
    }
    return merged;
  } catch {
    return fallback;
  }
}

function readStoredArray<T>(key: string, fallback: T[]): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T[] : fallback;
  } catch {
    return fallback;
  }
}

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = React.useState<T>(() => Array.isArray(fallback) ? readStoredArray(key, fallback) as T : readStored(key, fallback));

  React.useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function timestampLabel() {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function money(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency
  }).format(minor / 100);
}

function percent(value: number | null) {
  return value == null ? "Unknown" : `${value.toFixed(1)}%`;
}

function statusLabel(status: MarginStatus) {
  return status === "loss" ? "Not Profitable" : status === "warning" ? "Low Margin" : status === "unknown" ? "Missing Costs" : "Profitable";
}

function isCatalogProduct(product: ProductSummary) {
  return product.channel === "WordPress" && product.unitsSold === 0;
}

function storePlatformForIntegration(name: IntegrationName) {
  return name === "Shopify" ? "shopify" : name === "WooCommerce" ? "woocommerce" : name === "WordPress" ? "wordpress" : null;
}

function orderMatchesProduct(order: OrderSummary, product: ProductSummary) {
  const sourceId = product.id.replace(/^(shopify|woocommerce|wordpress)_/, "");
  return order.productIds?.some((id) => id === product.id || id === sourceId || product.id.endsWith(`_${id}`)) ?? false;
}

function planPrice(plan: PlanName) {
  return plan === "Starter" ? "$19" : plan === "Growth" ? "$49" : "$99";
}

function csvCell(value: string | number) {
  const text = String(value);
  return text.includes(",") || text.includes("\"") ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sessionToken() {
  return window.localStorage.getItem("tmt.sessionToken") || "";
}

function apiHeaders(json = false) {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  const token = sessionToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: apiHeaders(true),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "Request failed.", response.status);
  }
  return data as T;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "Request failed.", response.status);
  }
  return data as T;
}

async function patchJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "PATCH",
    headers: apiHeaders(true),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "Request failed.", response.status);
  }
  return data as T;
}

async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "DELETE",
    headers: apiHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "Delete failed.", response.status);
  }
  return data as T;
}

function currentRoute() {
  const hashView = window.location.hash.replace("#", "") as View;
  if (viewNames.includes(hashView)) {
    return { view: hashView };
  }

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "price-scout") {
    return { view: "scout" as View };
  }
  if (parts[0] === "license") {
    return { view: "billing" as View };
  }
  const pathView = parts[0] as View | undefined;
  if (pathView === "products" && parts[1]) {
    return { view: "product" as View, productId: decodeURIComponent(parts[1]) };
  }
  if (pathView && viewNames.includes(pathView)) {
    return { view: pathView };
  }
  return { view: "dashboard" as View };
}

function pathForView(view: View) {
  if (view === "dashboard") return "/";
  if (view === "scout") return "/price-scout";
  if (view === "product") return "/products";
  if (view === "billing") return "/license";
  return `/${view}`;
}

function App() {
  const initialRoute = React.useMemo(currentRoute, []);
  const [data, setData] = React.useState<OverviewPayload>(emptyOverview);
  const [orders, setOrders] = React.useState<OrderSummary[]>([]);
  const [selectedProductId, setSelectedProductId] = React.useState(initialRoute.productId ?? "");
  const [selectedAlertId, setSelectedAlertId] = React.useState("");
  const [view, setView] = React.useState<View>(initialRoute.view);
  const [apiState, setApiState] = React.useState<"live" | "local" | "loading">("loading");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [channelFilter, setChannelFilter] = React.useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [timeRange, setTimeRange] = React.useState("Last 30 days");
  const [storeFilter, setStoreFilter] = React.useState("All Stores");
  const [toast, setToast] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const [integrationFocus, setIntegrationFocus] = React.useState<IntegrationName | null>(null);
  const [authMode, setAuthMode] = React.useState<"checking" | "ready" | "required">("checking");
  const [authUser, setAuthUser] = React.useState<AuthUser | null>(null);
  const [integrations, setIntegrations] = useStoredState<IntegrationItem[]>("tmt.integrations", defaultIntegrations);
  const [workspaceSettings, setWorkspaceSettings] = useStoredState<WorkspaceSettings>("tmt.workspaceSettings", defaultWorkspaceSettings);
  const [costRules, setCostRules] = useStoredState<CostRules>("tmt.costRules", defaultCostRules);
  const [billing, setBilling] = useStoredState<BillingState>("tmt.billing", defaultBilling);
  const [activity, setActivity] = useStoredState<ActivityItem[]>("tmt.activity", []);

  const loadData = React.useCallback(async (silent = false) => {
    setRefreshing(true);
    try {
      const [payload, orderPayload] = await Promise.all([
        fetch(`${apiUrl}/analytics/overview`, { headers: apiHeaders() }).then((response) => {
          if (response.status === 401) {
            window.localStorage.removeItem("tmt.sessionToken");
            setAuthMode("required");
            throw new ApiError("Sign in to continue.", 401);
          }
          if (!response.ok) {
            throw new Error("API unavailable");
          }
          return response.json() as Promise<OverviewPayload>;
        }),
        fetch(`${apiUrl}/orders`, { headers: apiHeaders() }).then((response) => {
          if (response.status === 401) {
            window.localStorage.removeItem("tmt.sessionToken");
            setAuthMode("required");
            throw new ApiError("Sign in to continue.", 401);
          }
          if (!response.ok) {
            return { orders: [] as OrderSummary[] };
          }
          return response.json() as Promise<{ orders: OrderSummary[] }>;
        })
      ]);
      setData(payload);
      setOrders(orderPayload.orders);
      setApiState("live");
      if (!silent) {
        setToast("Data refreshed.");
      }
    } catch {
      setData(emptyOverview);
      setOrders([]);
      setApiState("local");
      if (!silent) {
        setToast("API unavailable.");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      try {
        const user = await getJson<AuthUser>("/me");
        if (cancelled) return;
        setAuthUser(user);
        setAuthMode("ready");
        void loadData(true);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setAuthMode("required");
          setApiState("live");
          return;
        }
        setAuthMode("ready");
        void loadData(true);
      }
    }
    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSavedConfiguration() {
      const [settingsResult, costResult, billingResult, storesResult] = await Promise.allSettled([
        getJson<{ settings: WorkspaceSettings }>("/workspace/settings"),
        getJson<{ rules: CostRules }>("/cost-rules"),
        getJson<{ billing: BillingState }>("/billing"),
        getJson<{ stores: StoreSummary[] }>("/stores")
      ]);
      if (cancelled) return;
      if (settingsResult.status === "fulfilled") {
        setWorkspaceSettings((current) => ({ ...current, ...settingsResult.value.settings }));
      }
      if (costResult.status === "fulfilled") {
        setCostRules((current) => ({ ...current, ...costResult.value.rules }));
      }
      if (billingResult.status === "fulfilled") {
        setBilling((current) => ({ ...current, ...billingResult.value.billing }));
      }
      if (storesResult.status === "fulfilled") {
        const connectedPlatforms = new Set(storesResult.value.stores.map((store) => store.platform));
        setIntegrations((current) => current.map((item) => {
          const platform = storePlatformForIntegration(item.name);
          if (!platform) return item;
          if (connectedPlatforms.has(platform)) {
            return { ...item, status: "Ready" };
          }
          return { ...item, status: "Needs setup", endpoint: "", token: "", signingSecret: "" };
        }));
      }
    }
    if (authMode === "ready") void loadSavedConfiguration();
    return () => {
      cancelled = true;
    };
  }, [authMode, setBilling, setCostRules, setIntegrations, setWorkspaceSettings]);

  React.useEffect(() => {
    const onRouteChange = () => {
      const nextRoute = currentRoute();
      setView(nextRoute.view);
      if (nextRoute.productId) setSelectedProductId(nextRoute.productId);
    };
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
    return () => {
      window.removeEventListener("popstate", onRouteChange);
      window.removeEventListener("hashchange", onRouteChange);
    };
  }, []);

  const selectedProduct = data.topProducts.find((productItem) => productItem.id === selectedProductId) ?? data.topProducts[0];
  const selectedAlert = data.alerts.find((alertItem) => alertItem.id === selectedAlertId) ?? data.alerts.find((alertItem) => alertItem.productId === selectedProduct?.id) ?? data.alerts[0];
  const filteredProducts = React.useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return data.topProducts.filter((item) => {
      const matchesSearch = !normalizedSearch || [item.title, item.sku, item.channel].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesChannel = channelFilter === "all" || item.channel === channelFilter;
      const matchesStatus = statusFilter === "all" || item.margin.status === statusFilter;
      const matchesStore = storeFilter === "All Stores" || item.channel === storeFilter;
      return matchesSearch && matchesChannel && matchesStatus && matchesStore;
    });
  }, [channelFilter, data.topProducts, searchTerm, statusFilter, storeFilter]);
  const filteredAlerts = React.useMemo(() => {
    const productIds = new Set(filteredProducts.map((item) => item.id));
    return data.alerts.filter((item) => productIds.has(item.productId));
  }, [data.alerts, filteredProducts]);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function navigate(nextView: View, pathOverride?: string) {
    setView(nextView);
    const nextPath = pathOverride ?? pathForView(nextView);
    if (window.location.pathname + window.location.hash !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  function recordActivity(label: string, status = "Done") {
    setActivity((items) => [
      { id: `${Date.now()}-${items.length}`, label, status, at: timestampLabel() },
      ...items
    ].slice(0, 20));
    setToast(label);
  }

  function openProduct(productId: string) {
    setSelectedProductId(productId);
    navigate("product", `/products/${encodeURIComponent(productId)}`);
  }

  function openAlert(alertId: string) {
    const nextAlert = data.alerts.find((alertItem) => alertItem.id === alertId);
    if (nextAlert) {
      setSelectedAlertId(alertId);
      setSelectedProductId(nextAlert.productId);
    }
    navigate("alerts");
  }

  function exportProducts() {
    const header = ["Product", "SKU", "Channel", "Revenue", "Real Margin", "Margin %", "Ad Cost", "Shipping", "Fees", "Returns", "Status"];
    const rows = filteredProducts.map((item) => [
      item.title,
      item.sku,
      item.channel,
      item.margin.revenueNetMinor,
      item.margin.trueMarginMinor,
      item.margin.trueMarginPercent ?? "",
      item.adCostMinor,
      item.shippingCostMinor,
      item.feesMinor,
      item.returnsMinor,
      statusLabel(item.margin.status)
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "true-margin-products.csv";
    link.click();
    URL.revokeObjectURL(url);
    setToast("Product CSV exported.");
  }

  async function deleteProduct(product: ProductSummary) {
    if (!window.confirm(`Delete ${product.title}?`)) return;
    try {
      await deleteJson<{ deleted: boolean }>(`/products/${encodeURIComponent(product.id)}`);
      if (selectedProductId === product.id) {
        setSelectedProductId("");
      }
      await loadData(true);
      setToast(`${product.title} deleted.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Product could not be deleted.");
    }
  }

  async function deleteOrder(order: OrderSummary) {
    if (!window.confirm(`Delete order ${order.sourceOrderId}?`)) return;
    try {
      await deleteJson<{ deleted: boolean }>(`/orders/${encodeURIComponent(order.id)}`);
      await loadData(true);
      setToast(`Order ${order.sourceOrderId} deleted.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Order could not be deleted.");
    }
  }

  async function handleAuthenticated(token: string, user: AuthUser) {
    window.localStorage.setItem("tmt.sessionToken", token);
    setAuthUser(user);
    setAuthMode("ready");
    await loadData(true);
  }

  async function logout() {
    try {
      await postJson<{ loggedOut: boolean }>("/auth/logout", {});
    } catch {
      // The local token is removed even if the API session is already gone.
    }
    window.localStorage.removeItem("tmt.sessionToken");
    setAuthUser(null);
    setAuthMode("required");
  }

  if (authMode === "checking") {
    return <AuthShell status="Loading" />;
  }

  if (authMode === "required") {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        setView={navigate}
        alertCount={data.alerts.length}
        integrations={integrations}
        billing={billing}
        openIntegrationSetup={(name) => {
          setIntegrationFocus(name);
          navigate("integrations");
        }}
      />
      <main className="workspace">
        <Topbar
          apiState={apiState}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          storeFilter={storeFilter}
          setStoreFilter={setStoreFilter}
          openAlerts={() => navigate("alerts")}
          refreshData={() => void loadData()}
          refreshing={refreshing}
          user={authUser}
          logout={sessionToken() ? () => void logout() : undefined}
        />
        {toast ? <div className="toast" role="status">{toast}</div> : null}
        {view === "dashboard" ? (
          <DashboardView
            data={data}
            openProduct={openProduct}
            openAlert={openAlert}
            openAlerts={() => navigate("alerts")}
            openShopify={() => {
              setIntegrationFocus("Shopify");
              navigate("integrations");
            }}
            openWooCommerce={() => {
              setIntegrationFocus("WooCommerce");
              navigate("integrations");
            }}
            openWordPress={() => {
              setIntegrationFocus("WordPress");
              navigate("integrations");
            }}
            openScout={() => navigate("scout")}
            exportProducts={exportProducts}
          />
        ) : null}
        {view === "scout" ? <PriceScoutView notify={setToast} /> : null}
        {view === "products" ? (
          <ProductsView
            products={filteredProducts}
            openProduct={openProduct}
            exportProducts={exportProducts}
            channelFilter={channelFilter}
            setChannelFilter={setChannelFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            deleteProduct={deleteProduct}
          />
        ) : null}
        {view === "product" ? selectedProduct ? <ProductDetailView product={selectedProduct} orders={orders.filter((order) => orderMatchesProduct(order, selectedProduct))} openCosts={() => navigate("costs")} /> : <EmptyState title="No product selected." action="Install a store plugin or open a synced product first." /> : null}
        {view === "orders" ? <OrdersView orders={orders} openIntegrations={() => navigate("integrations")} deleteOrder={deleteOrder} /> : null}
        {view === "alerts" ? <AlertsView alerts={filteredAlerts} products={data.topProducts} selectedAlert={selectedAlert} openAlert={openAlert} openProduct={openProduct} /> : null}
        {view === "costs" ? <CostsView products={filteredProducts} rules={costRules} setRules={setCostRules} recordActivity={recordActivity} /> : null}
        {view === "integrations" ? <IntegrationsView integrations={integrations} setIntegrations={setIntegrations} focusIntegration={integrationFocus} clearFocus={() => setIntegrationFocus(null)} openCosts={() => navigate("costs")} recordActivity={recordActivity} /> : null}
        {view === "settings" ? <SettingsView settings={workspaceSettings} setSettings={setWorkspaceSettings} recordActivity={recordActivity} /> : null}
        {view === "billing" ? <BillingView billing={billing} setBilling={setBilling} activity={activity} recordActivity={recordActivity} /> : null}
      </main>
    </div>
  );
}

function AuthShell({ status }: { status: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark">TM</div>
          <span>True Margin Tracker</span>
        </div>
        <strong>{status}</strong>
      </section>
    </main>
  );
}

function AuthView({ onAuthenticated }: { onAuthenticated: (token: string, user: AuthUser) => Promise<void> }) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("Main workspace");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = mode === "register"
        ? { email, password, name, workspaceName }
        : { email, password };
      const result = await postJson<{ token: string; user: AuthUser }>(mode === "register" ? "/auth/register" : "/auth/login", payload);
      await onAuthenticated(result.token, result.user);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Account request failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark">TM</div>
          <span>True Margin Tracker</span>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" ? <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label> : null}
          {mode === "register" ? <label><span>Workspace</span><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} autoComplete="organization" /></label> : null}
          <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 8 : 1} /></label>
          {error ? <div className="field-error" role="alert">{error}</div> : null}
          <button type="submit" disabled={saving}>{saving ? "Saving" : mode === "register" ? "Create Account" : "Sign In"}</button>
        </form>
      </section>
    </main>
  );
}

function Sidebar({
  view,
  setView,
  alertCount,
  integrations,
  billing,
  openIntegrationSetup
}: {
  view: View;
  setView: (view: View) => void;
  alertCount: number;
  integrations: IntegrationItem[];
  billing: BillingState;
  openIntegrationSetup: (name: IntegrationName) => void;
}) {
  const shopifyStatus = integrations.find((item) => item.name === "Shopify")?.status ?? "Needs setup";
  const wooStatus = integrations.find((item) => item.name === "WooCommerce")?.status ?? "Needs setup";
  const wordpressStatus = integrations.find((item) => item.name === "WordPress")?.status ?? "Needs setup";
  const items: Array<{ view: View; label: string; icon: React.ReactNode; badge?: number }> = [
    { view: "dashboard", label: "Dashboard", icon: <Home size={18} /> },
    { view: "scout", label: "Price Scout", icon: <Search size={18} /> },
    { view: "products", label: "Products", icon: <PackageSearch size={18} /> },
    { view: "orders", label: "Orders", icon: <ShoppingBag size={18} /> },
    { view: "alerts", label: "Alerts", icon: <AlertTriangle size={18} />, badge: alertCount },
    { view: "costs", label: "Costs", icon: <Box size={18} /> },
    { view: "integrations", label: "Plugin Setup", icon: <Plug size={18} /> },
    { view: "settings", label: "Settings", icon: <Settings size={18} /> },
    { view: "billing", label: "License", icon: <KeyRound size={18} /> }
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">TM</div>
        <span>True Margin Tracker</span>
      </div>
      <nav>
        {items.map((item) => (
          <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}>
            {item.icon}
            <span>{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="channel-list">
        <span>Sales channels</span>
        <button className="channel-button" onClick={() => openIntegrationSetup("Shopify")}>
          <strong>Shopify</strong>
          <small className={shopifyStatus === "Ready" ? "ready" : ""}>{shopifyStatus === "Ready" ? "Ready" : "Setup"}</small>
        </button>
        <button className="channel-button" onClick={() => openIntegrationSetup("WooCommerce")}>
          <strong>WooCommerce</strong>
          <small className={wooStatus === "Ready" ? "ready" : ""}>{wooStatus === "Ready" ? "Ready" : "Setup"}</small>
        </button>
        <button className="channel-button" onClick={() => openIntegrationSetup("WordPress")}>
          <strong>WordPress</strong>
          <small className={wordpressStatus === "Ready" ? "ready" : ""}>{wordpressStatus === "Ready" ? "Ready" : "Setup"}</small>
        </button>
      </div>
      <div className="plan-box">
        <span>{billing.licenseStatus === "Active" ? "License active" : "License"}</span>
        <strong>{billing.licenseStatus === "Active" ? billing.plan : "No license"}</strong>
        <span>{billing.licenseStatus === "Active" ? `${planPrice(billing.plan)} / month` : "Activation required"}</span>
        <button onClick={() => setView("billing")}>{billing.licenseStatus === "Active" ? "Manage License" : "Activate"}</button>
      </div>
    </aside>
  );
}

function Topbar({
  apiState,
  searchTerm,
  setSearchTerm,
  timeRange,
  setTimeRange,
  storeFilter,
  setStoreFilter,
  openAlerts,
  refreshData,
  refreshing,
  user,
  logout
}: {
  apiState: "live" | "local" | "loading";
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  timeRange: string;
  setTimeRange: (value: string) => void;
  storeFilter: string;
  setStoreFilter: (value: string) => void;
  openAlerts: () => void;
  refreshData: () => void;
  refreshing: boolean;
  user: AuthUser | null;
  logout: (() => void) | undefined;
}) {
  const initials = (user?.name || user?.email || "TM")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TM";
  return (
    <header className="topbar">
      <label className="search">
        <Search size={18} />
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search products, orders, alerts..." />
      </label>
      <div className="top-actions">
        <label className="select-control"><CalendarDays size={16} /><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}><option>Last 30 days</option><option>Last 7 days</option><option>Last 90 days</option></select></label>
        <label className="select-control"><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option>All Stores</option><option>Shopify</option><option>WooCommerce</option><option>WordPress</option></select></label>
        <span className={`api-pill ${apiState}`}>{apiState === "live" ? "Live API" : apiState === "loading" ? "Loading" : "API offline"}</span>
        <button className="icon-button" onClick={refreshData} disabled={refreshing} aria-label="Refresh data"><RefreshCw size={17} /></button>
        <button className="icon-button" onClick={openAlerts} aria-label="Open alerts"><Bell size={17} /></button>
        {logout ? <button className="user-avatar" onClick={logout} aria-label="Sign out">{initials}</button> : <div className="user-avatar">{initials}</div>}
      </div>
    </header>
  );
}

function PageTitle({ title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <section className="page-title">
      <div>
        <h1>{title}</h1>
      </div>
      {action}
    </section>
  );
}

function ConnectionPanel({ openShopify, openWooCommerce, openWordPress, openScout }: { openShopify: () => void; openWooCommerce: () => void; openWordPress: () => void; openScout: () => void }) {
  return (
    <section className="panel connection-panel">
      <h2>Start with real data</h2>
      <div className="start-card-grid">
        <button className="start-card shopify" onClick={openShopify}>
          <span><Plug size={19} /></span>
          <strong>Install Shopify</strong>
        </button>
        <button className="start-card woocommerce" onClick={openWooCommerce}>
          <span><Download size={19} /></span>
          <strong>Install WooCommerce</strong>
        </button>
        <button className="start-card wordpress" onClick={openWordPress}>
          <span><Download size={19} /></span>
          <strong>Install WordPress</strong>
        </button>
        <button className="start-card scout" onClick={openScout}>
          <span><Search size={19} /></span>
          <strong>Scan Product</strong>
        </button>
      </div>
    </section>
  );
}

function DashboardView({
  data,
  openProduct,
  openAlert,
  openAlerts,
  openShopify,
  openWooCommerce,
  openWordPress,
  openScout,
  exportProducts
}: {
  data: OverviewPayload;
  openProduct: (id: string) => void;
  openAlert: (id: string) => void;
  openAlerts: () => void;
  openShopify: () => void;
  openWooCommerce: () => void;
  openWordPress: () => void;
  openScout: () => void;
  exportProducts: () => void;
}) {
  const hasProducts = data.topProducts.length > 0;
  const hasSalesData = data.topProducts.some((product) => product.unitsSold > 0);
  return (
    <>
      <PageTitle eyebrow="Global Shopify and WooCommerce profitability" title="Real margin, after every cost." />
      <section className="metrics-grid">
        <Metric icon={<TrendingUp />} label="Revenue" value={money(data.metrics.revenueMinor)} delta={hasSalesData ? "Synced" : "No data"} tone="green" />
        <Metric icon={<Gauge />} label="Real Margin" value={money(data.metrics.realMarginMinor)} delta={hasSalesData ? "Calculated" : "No data"} tone="green" />
        <Metric icon={<DollarSign />} label="Ad Cost" value={money(data.metrics.adCostMinor)} delta={hasSalesData ? "Imported" : "No data"} tone="red" />
        <Metric icon={<Truck />} label="Shipping Cost" value={money(data.metrics.shippingCostMinor)} delta={hasSalesData ? "Rules" : "No data"} tone="orange" />
        <Metric icon={<RefreshCw />} label="Return Cost" value={money(data.metrics.returnCostMinor)} delta={hasSalesData ? "Tracked" : "No data"} tone="red" />
        <Metric icon={<CreditCard />} label="Fees" value={money(data.metrics.feesMinor)} delta={hasSalesData ? "Calculated" : "No data"} tone="blue" />
      </section>

      {hasProducts && hasSalesData ? (
        <>
          <section className="content-grid">
            <TrendPanel />
            <CostBreakdownPanel metrics={data.metrics} />
            <aside className="panel alert-panel">
              <div className="panel-header">
                <h2>Alerts</h2>
                <button onClick={openAlerts}>View all</button>
              </div>
              <div className="alert-list">
                {data.alerts.slice(0, 4).map((alertItem) => (
                  <button key={alertItem.id} className={`alert-item ${alertItem.severity}`} onClick={() => openAlert(alertItem.id)}>
                    <strong>{alertItem.title}</strong>
                    <span>{alertItem.message}</span>
                  </button>
                ))}
              </div>
            </aside>
          </section>

          <section className="panel table-panel">
            <div className="panel-header">
              <h2>Top Products</h2>
              <button onClick={exportProducts}><Download size={16} />Export CSV</button>
            </div>
            <ProductTable products={data.topProducts.slice(0, 5)} openProduct={openProduct} compact />
          </section>
        </>
      ) : <ConnectionPanel openShopify={openShopify} openWooCommerce={openWooCommerce} openWordPress={openWordPress} openScout={openScout} />}
    </>
  );
}

function PriceScoutView({ notify }: { notify: (message: string) => void }) {
  const [productUrl, setProductUrl] = React.useState("");
  const [listedPrice, setListedPrice] = React.useState("");
  const [cogs, setCogs] = React.useState("");
  const [shipping, setShipping] = React.useState("");
  const [fees, setFees] = React.useState("");
  const [adCost, setAdCost] = React.useState("");
  const [targetMargin, setTargetMargin] = React.useState("");
  const [scanState, setScanState] = React.useState<ScoutState>("idle");
  const [error, setError] = React.useState("");
  const [product, setProduct] = React.useState<ScoutProductResult | null>(null);
  const [market, setMarket] = React.useState<ScoutMarketResult | null>(null);

  const extractedPriceMinor = product?.priceMinor ?? null;
  const calculation = calculateScout({
    listedPriceMinor: parseMoneyInput(listedPrice) ?? extractedPriceMinor,
    cogsMinor: parseMoneyInput(cogs),
    shippingMinor: parseMoneyInput(shipping),
    feesMinor: parseMoneyInput(fees),
    adCostMinor: parseMoneyInput(adCost),
    targetMarginPercent: parsePercentInput(targetMargin)
  });
  const decisionTone = !calculation.complete ? "unknown" : calculation.marginPercent != null && calculation.targetMarginPercent != null && calculation.marginPercent >= calculation.targetMarginPercent ? "profitable" : "warning";
  const marketSpreadMinor = product?.priceMinor != null && market?.lowest ? product.priceMinor - market.lowest.priceMinor : null;
  const marketStatusLabel = market?.status === "ready" ? "Live" : market?.status === "not_found" ? "No matches" : market?.status === "error" ? "Error" : "Not connected";

  async function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setScanState("loading");

    try {
      const response = await fetch(`${apiUrl}/price-scout/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: productUrl.trim() })
      });
      const payload = await response.json() as { product?: ScoutProductResult; market?: ScoutMarketResult; error?: string };

      if (!response.ok || !payload.product) {
        throw new Error(payload.error ?? "Product scan failed.");
      }

      setProduct(payload.product);
      setMarket(payload.market ?? null);
      setScanState("ready");
      notify("Product URL scanned.");
    } catch (caughtError) {
      setScanState("error");
      setProduct(null);
      setMarket(null);
      setError(caughtError instanceof Error ? caughtError.message : "Product scan failed.");
    }
  }

  return (
    <>
      <PageTitle eyebrow="Product intelligence" title="Price Scout" />
      <section className="scout-workspace">
        <form className="panel scout-scan-card" onSubmit={handleAnalyze}>
          <div className="panel-header">
            <h2>Scan</h2>
            <button type="submit" disabled={scanState === "loading"}><Search size={16} />{scanState === "loading" ? "Scanning" : "Analyze"}</button>
          </div>
          <label className="scout-url-field">
            <span>URL</span>
            <input value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="https://store.com/products/product-name" />
          </label>
          {error ? <div className="field-error" role="alert">{error}</div> : null}
        </form>

        <article className="panel scout-product-panel">
          <div className="panel-header">
            <h2>Product</h2>
            {product ? <a className="inline-link" href={product.url} target="_blank" rel="noreferrer">Open</a> : null}
          </div>
          {product ? (
            <div className="scout-product-body">
              {product.imageUrl ? <img className="scout-product-image" src={product.imageUrl} alt="" /> : <div className="scout-image-empty">TM</div>}
              <div className="scout-facts">
                <div><span>Name</span><strong>{product.title ?? "Not found"}</strong></div>
                <div><span>Host</span><strong>{product.host}</strong></div>
                <div><span>Price</span><strong>{product.priceMinor == null ? "Not found" : money(product.priceMinor, product.currency ?? "USD")}</strong></div>
                <div><span>Source</span><strong>{product.source.toUpperCase()}</strong></div>
              </div>
            </div>
          ) : <EmptyState title="No product" action="Enter a product URL" />}
        </article>

        <article className="panel scout-market-panel">
          <div className="panel-header">
            <h2>Market</h2>
            <span className={`status ${market?.status === "ready" ? "profitable" : market?.status === "error" ? "loss" : "unknown"}`}>{marketStatusLabel}</span>
          </div>
          {market ? (
            <>
              <div className="rule-tile-grid scout-tile-grid">
                <RuleTile label="Cheapest" value={market.lowest ? money(market.lowest.priceMinor, market.lowest.currency) : "Missing" } tone={market.status === "ready" ? "green" : "blue"} />
                <RuleTile label="Spread" value={marketSpreadMinor == null ? "Missing" : money(marketSpreadMinor, product?.currency ?? market.lowest?.currency ?? "USD")} tone={marketSpreadMinor != null && marketSpreadMinor > 0 ? "green" : "orange"} />
              </div>
              {market.matches.length ? (
                <div className="market-match-list">
                  {market.matches.slice(0, 5).map((match) => (
                    <a className="market-match-row" key={match.url} href={match.url} target="_blank" rel="noreferrer">
                      <span>
                        <strong>{match.title}</strong>
                        <small>{match.host}</small>
                      </span>
                      <b>{money(match.priceMinor, match.currency)}</b>
                    </a>
                  ))}
                </div>
              ) : <EmptyState title={market.status === "error" ? "Search failed" : "No matches"} action={market.error ?? (market.provider ? market.provider : "Connect provider")} />}
            </>
          ) : <EmptyState title="No market" action="Analyze a product" />}
        </article>

        <article className="panel scout-cost-card">
          <h2>Costs</h2>
          <div className="scout-input-grid">
            <label><span>Price override</span><input inputMode="decimal" value={listedPrice} onChange={(event) => setListedPrice(event.target.value)} /></label>
            <label><span>COGS</span><input inputMode="decimal" value={cogs} onChange={(event) => setCogs(event.target.value)} /></label>
            <label><span>Shipping</span><input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} /></label>
            <label><span>Fees</span><input inputMode="decimal" value={fees} onChange={(event) => setFees(event.target.value)} /></label>
            <label><span>Ad spend</span><input inputMode="decimal" value={adCost} onChange={(event) => setAdCost(event.target.value)} /></label>
            <label><span>Target %</span><input inputMode="decimal" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} /></label>
          </div>
        </article>

        <article className={`panel scout-decision-card ${decisionTone}`}>
          <div className="panel-header">
            <h2>Decision</h2>
            <span className={`status ${decisionTone}`}>{calculation.complete ? (decisionTone === "profitable" ? "Protected" : "Low margin") : "Incomplete"}</span>
          </div>
          <div className="rule-tile-grid scout-tile-grid">
            <RuleTile label="Price" value={calculation.listedPriceMinor == null ? "Missing" : money(calculation.listedPriceMinor, product?.currency ?? "USD")} tone="blue" />
            <RuleTile label="Costs" value={calculation.totalCostMinor == null ? "Missing" : money(calculation.totalCostMinor, product?.currency ?? "USD")} tone="orange" />
            <RuleTile label="Margin" value={calculation.marginPercent == null ? "Missing" : percent(calculation.marginPercent)} tone={decisionTone === "profitable" ? "green" : "red"} />
            <RuleTile label="Floor" value={calculation.floorMinor == null ? "Missing" : money(calculation.floorMinor, product?.currency ?? "USD")} tone="purple" />
          </div>
        </article>
      </section>
    </>
  );
}

function ProductsView({
  products,
  openProduct,
  exportProducts,
  channelFilter,
  setChannelFilter,
  statusFilter,
  setStatusFilter,
  deleteProduct
}: {
  products: ProductSummary[];
  openProduct: (id: string) => void;
  exportProducts: () => void;
  channelFilter: ChannelFilter;
  setChannelFilter: (filter: ChannelFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (filter: StatusFilter) => void;
  deleteProduct: (product: ProductSummary) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Product profitability"
        title="Products"
        action={
          <div className="toolbar">
            <button onClick={() => { setChannelFilter("all"); setStatusFilter("all"); }}><SlidersHorizontal size={16} />Reset filters</button>
            <button onClick={exportProducts}><Download size={16} />Export CSV</button>
          </div>
        }
      />
      <div className="filter-row">
        <button className={channelFilter === "all" && statusFilter === "all" ? "active" : ""} onClick={() => { setChannelFilter("all"); setStatusFilter("all"); }}>All products</button>
        <button className={channelFilter === "Shopify" ? "active" : ""} onClick={() => setChannelFilter("Shopify")}>Shopify</button>
        <button className={channelFilter === "WooCommerce" ? "active" : ""} onClick={() => setChannelFilter("WooCommerce")}>WooCommerce</button>
        <button className={channelFilter === "WordPress" ? "active" : ""} onClick={() => setChannelFilter("WordPress")}>WordPress</button>
        <button className={statusFilter === "loss" ? "active" : ""} onClick={() => setStatusFilter("loss")}>Not Profitable</button>
        <button className={statusFilter === "unknown" ? "active" : ""} onClick={() => setStatusFilter("unknown")}>Missing Costs</button>
      </div>
      <section className="panel table-panel wide">
        {products.length ? <ProductTable products={products} openProduct={openProduct} onDelete={deleteProduct} /> : <EmptyState title="No products" action="Install a store plugin" />}
        <div className="pagination">
          <span>Showing 1 to {products.length} of {products.length} products</span>
        </div>
      </section>
    </>
  );
}

function ProductDetailView({ product, orders, openCosts }: { product: ProductSummary; orders: OrderSummary[]; openCosts: () => void }) {
  const catalog = isCatalogProduct(product);
  const costAmount = (key: string) => product.margin.costs.find((cost) => cost.key === key)?.amountMinor ?? 0;
  const costs: Array<[string, number]> = [
    [catalog ? "Listed Price" : "Selling Price", product.margin.revenueNetMinor],
    ["Product Cost", costAmount("cogs")],
    ["Packaging Cost", costAmount("packaging")],
    ["Shipping Cost", costAmount("shipping")],
    ["Ad Cost", costAmount("ad_spend")],
    ["Transaction Fees", costAmount("payment_processing")],
    ["Return Cost", costAmount("return_shipping")]
  ];

  return (
    <>
      <PageTitle eyebrow={`Products / ${product.sku}`} title={product.title} action={<button onClick={openCosts}>Edit Costs</button>} />
      <section className="product-hero panel">
        <div className={`product-large ${product.image}`}></div>
        <div className="product-hero-copy">
          <div className="product-title-row">
            <h2>{product.title}</h2>
            <span className={`status ${catalog ? "unknown" : product.margin.status}`}>{catalog ? "Catalog" : statusLabel(product.margin.status)}</span>
          </div>
          <p>{product.sku} · {product.channel} · {catalog ? "Catalog Mode" : "Main Store"}</p>
          <div className="hero-metric-grid">
            <div><span>{catalog ? "Projected Margin" : "Real Margin per sale"}</span><strong>{money(Math.round(product.margin.trueMarginMinor / Math.max(product.unitsSold, 1)))}</strong></div>
            <div><span>{catalog ? "Projected Margin %" : "Real Margin %"}</span><strong>{percent(product.margin.trueMarginPercent)}</strong></div>
            <div><span>Break-even CPA</span><strong>{money(product.margin.breakEvenCpaMinor)}</strong></div>
            <div><span>{catalog ? "Synced Orders" : "Total Profit"}</span><strong className={product.margin.trueMarginMinor < 0 ? "negative" : "positive"}>{catalog ? "0" : money(product.margin.trueMarginMinor)}</strong></div>
          </div>
        </div>
      </section>
      <section className="detail-grid">
        <div className="panel">
          <h2>Cost Breakdown</h2>
          <div className="cost-list">
            {costs.map(([label, amount]) => (
              <div key={label.toString()}><span>{label}</span><strong>{money(Number(amount))}</strong></div>
            ))}
            <div className="total-line"><span>{catalog ? "Projected Profit" : "Real Profit"}</span><strong className={product.margin.trueMarginMinor < 0 ? "negative" : "positive"}>{money(product.margin.trueMarginMinor)}</strong></div>
          </div>
        </div>
        {catalog ? (
          <div className="panel">
            <h2>Orders</h2>
            <EmptyState title="No synced orders" action="Catalog price only" />
          </div>
        ) : (
          <>
            <TrendPanel title="Profitability Over Time" />
            <div className="panel">
              <h2>Quick Insights</h2>
              <Insight icon={<TrendingUp />} title="Break-even CPA" value={money(product.margin.breakEvenCpaMinor)} />
              <Insight icon={<CreditCard />} title="Fees as revenue" value={`${((product.feesMinor / product.margin.revenueNetMinor) * 100).toFixed(1)}%`} />
              <Insight icon={<TrendingDown />} title="Return impact" value={money(product.returnsMinor)} />
            </div>
          </>
        )}
      </section>
      <section className="panel table-panel">
        <div className="panel-header"><h2>Recent Orders</h2><button onClick={openCosts}>Review costs</button></div>
        {orders.length ? <OrderTable orders={orders} /> : <EmptyState title="No orders" action={catalog ? "No synced orders" : "Sync order history"} />}
      </section>
    </>
  );
}

function AlertsView({ alerts, products, selectedAlert, openAlert, openProduct }: { alerts: AlertEvent[]; products: ProductSummary[]; selectedAlert: AlertEvent | undefined; openAlert: (id: string) => void; openProduct: (id: string) => void }) {
  const [alertFilter, setAlertFilter] = React.useState<"all" | AlertEvent["severity"]>("all");
  const visibleAlerts = alertFilter === "all" ? alerts : alerts.filter((item) => item.severity === alertFilter);
  const selectedProduct = products.find((productItem) => productItem.id === selectedAlert?.productId) ?? products[0];
  return (
    <>
      <PageTitle eyebrow="Profit protection" title="Alerts / Non-Profitable Products" />
      <div className="filter-row alert-tabs">
        <button className={alertFilter === "all" ? "active" : ""} onClick={() => setAlertFilter("all")}>All Alerts <span>{alerts.length}</span></button>
        <button className={alertFilter === "loss" ? "active" : ""} onClick={() => setAlertFilter("loss")}>Not Profitable <span>{alerts.filter((item) => item.severity === "loss").length}</span></button>
        <button className={alertFilter === "unknown" ? "active" : ""} onClick={() => setAlertFilter("unknown")}>Missing Costs <span>{alerts.filter((item) => item.severity === "unknown").length}</span></button>
        <button className={alertFilter === "warning" ? "active" : ""} onClick={() => setAlertFilter("warning")}>Low Margin <span>{alerts.filter((item) => item.severity === "warning").length}</span></button>
      </div>
      <section className="alert-layout">
        <div className="panel table-panel">
          {visibleAlerts.length ? <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Revenue</th>
                <th>Real Margin</th>
                <th>Margin %</th>
                <th>Ad Cost</th>
                <th>Returns</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visibleAlerts.map((alertItem) => {
                const productItem = products.find((item) => item.id === alertItem.productId);
                if (!productItem) return null;
                return (
                  <tr key={alertItem.id} className={selectedAlert?.id === alertItem.id ? "selected-row" : ""} onClick={() => openAlert(alertItem.id)}>
                    <td><span className={`thumb ${productItem.image}`}></span><span><strong>{productItem.title}</strong><small>{productItem.channel}</small></span></td>
                    <td>{money(productItem.margin.revenueNetMinor)}</td>
                    <td className={productItem.margin.trueMarginMinor < 0 ? "negative" : "positive"}>{money(productItem.margin.trueMarginMinor)}</td>
                    <td>{percent(productItem.margin.trueMarginPercent)}</td>
                    <td>{money(productItem.adCostMinor)}</td>
                    <td>{money(productItem.returnsMinor)}</td>
                    <td><span className={`status ${productItem.margin.status}`}>{statusLabel(productItem.margin.status)}</span></td>
                    <td>{alertItem.updatedMinutesAgo}m ago</td>
                  </tr>
                );
              })}
            </tbody>
          </table> : <EmptyState title="No alerts" action="Install a store plugin" />}
        </div>
        {selectedAlert && selectedProduct ? (
          <aside className="panel inspector">
            <h2>{selectedAlert.title}</h2>
            <span className={`status ${selectedProduct.margin.status}`}>{statusLabel(selectedProduct.margin.status)}</span>
            <p className="muted">{selectedAlert.message}</p>
            <div className="inspector-metrics">
              <div><span>Real Margin</span><strong className={selectedProduct.margin.trueMarginMinor < 0 ? "negative" : "positive"}>{money(selectedProduct.margin.trueMarginMinor)}</strong></div>
              <div><span>Margin %</span><strong>{percent(selectedProduct.margin.trueMarginPercent)}</strong></div>
              <div><span>Revenue</span><strong>{money(selectedProduct.margin.revenueNetMinor)}</strong></div>
              <div><span>Break-even CPA</span><strong>{money(selectedProduct.margin.breakEvenCpaMinor)}</strong></div>
            </div>
            <div className="suggestion">
              <strong>Suggested action</strong>
              <p>{selectedAlert.suggestedAction}</p>
            </div>
            <button onClick={() => openProduct(selectedProduct.id)}>View Product <ChevronRight size={16} /></button>
          </aside>
        ) : (
          <aside className="panel inspector">
            <EmptyState title="No alerts" action="Install a store plugin" />
          </aside>
        )}
      </section>
    </>
  );
}

function CostsView({
  products,
  rules,
  setRules,
  recordActivity
}: {
  products: ProductSummary[];
  rules: CostRules;
  setRules: React.Dispatch<React.SetStateAction<CostRules>>;
  recordActivity: (label: string, status?: string) => void;
}) {
  const [importOpen, setImportOpen] = React.useState(false);
  const [csvText, setCsvText] = React.useState("");
  const [csvError, setCsvError] = React.useState("");

  function updateRule(key: keyof CostRules, value: string) {
    setRules((current) => ({ ...current, [key]: value }));
  }

  async function saveRules() {
    try {
      await postJson<{ saved: boolean }>("/cost-rules", rules);
      recordActivity("Cost rules saved.");
    } catch {
      recordActivity("Cost rules saved locally.", "Offline");
    }
  }

  async function applyImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rows = csvText.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    if (!rows.length) {
      setCsvError("Paste at least one CSV row.");
      return;
    }

    try {
      const result = await postJson<{ saved: boolean; importedRows: number }>("/costs/import", { csv: csvText });
      setRules((current) => ({ ...current, importedRows: result.importedRows }));
      setCsvError("");
      setCsvText("");
      setImportOpen(false);
      recordActivity(`${result.importedRows} cost rows imported.`, "Imported");
    } catch (caughtError) {
      setCsvError(caughtError instanceof Error ? caughtError.message : "Invalid CSV import.");
    }
  }

  return (
    <>
      <PageTitle eyebrow="Cost rules" title="Costs" action={<button onClick={saveRules}>Save</button>} />
      <section className="settings-grid compact-costs">
        <div className="panel table-panel">
          <div className="panel-header"><h2>Products</h2><button onClick={() => setImportOpen(true)}>Import</button></div>
          {products.length ? <table>
            <thead><tr><th>Product</th><th>COGS</th><th>Pack</th><th>Return</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {products.map((item) => (
                <ProductCostRow key={item.id} product={item} recordActivity={recordActivity} />
              ))}
            </tbody>
          </table> : <EmptyState title="No costs" action={rules.importedRows ? `${rules.importedRows} imported rows ready` : "Install a store plugin"} />}
        </div>
        <div className="panel cost-rule-panel">
          <h2>Rules</h2>
          <div className="cost-input-grid">
            <RuleInput title="Shipping" value={rules.shippingFallback} onChange={(value) => updateRule("shippingFallback", value)} suffix="order" />
            <RuleInput title="Returns" value={rules.returnShipping} onChange={(value) => updateRule("returnShipping", value)} suffix="return" />
            <RuleInput title="Packaging" value={rules.packagingCost} onChange={(value) => updateRule("packagingCost", value)} suffix="item" />
            <label className="rule-row rule-input">
              <span>Tax</span>
              <strong>
                <select value={rules.taxMode} onChange={(event) => updateRule("taxMode", event.target.value)}>
                  <option value="">Setup</option>
                  <option value="excluded">Excluded</option>
                  <option value="included">Included</option>
                </select>
              </strong>
            </label>
          </div>
        </div>
      </section>
      {importOpen ? (
        <Modal title="Import Costs" close={() => setImportOpen(false)}>
          <form className="stacked-form" onSubmit={applyImport}>
            <label>
              <span>CSV</span>
              <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="sku,cogs,packaging,return" />
            </label>
            {csvError ? <div className="field-error" role="alert">{csvError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setImportOpen(false)}>Cancel</button>
              <button type="submit">Import</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function ProductCostRow({ product, recordActivity }: { product: ProductSummary; recordActivity: (label: string, status?: string) => void }) {
  const productKey = `tmt.productCosts.${product.id}`;
  const [costs, setCosts] = useStoredState(productKey, {
    cogs: product.margin.missingCosts.includes("cogs") ? "" : (Math.round(product.margin.variableCostsMinor * 0.38) / 100).toFixed(2),
    packaging: (Math.round(product.margin.variableCostsMinor * 0.04) / 100).toFixed(2),
    returns: (product.returnsMinor / 100).toFixed(2)
  });

  async function saveCosts() {
    const payload = {
      cogsMinor: parseMoneyInput(costs.cogs),
      packagingCostMinor: parseMoneyInput(costs.packaging) ?? 0,
      returnCostMinor: parseMoneyInput(costs.returns) ?? 0
    };

    try {
      await patchJson<{ saved: boolean }>(`/products/${encodeURIComponent(product.id)}/costs`, payload);
      recordActivity(`${product.title} costs saved.`);
    } catch {
      recordActivity(`${product.title} costs saved locally.`, "Offline");
    }
  }

  return (
    <tr>
      <td><span className={`thumb ${product.image}`}></span><span><strong>{product.title}</strong><small>{product.sku}</small></span></td>
      <td><input className="money-input" value={costs.cogs} onChange={(event) => setCosts((current) => ({ ...current, cogs: event.target.value }))} aria-label={`${product.title} product cost`} /></td>
      <td><input className="money-input" value={costs.packaging} onChange={(event) => setCosts((current) => ({ ...current, packaging: event.target.value }))} aria-label={`${product.title} packaging cost`} /></td>
      <td><input className="money-input" value={costs.returns} onChange={(event) => setCosts((current) => ({ ...current, returns: event.target.value }))} aria-label={`${product.title} return cost`} /></td>
      <td><span className={`status ${product.margin.status}`}>{statusLabel(product.margin.status)}</span></td>
      <td><button onClick={saveCosts}>Save</button></td>
    </tr>
  );
}

function IntegrationsView({
  integrations,
  setIntegrations,
  focusIntegration,
  clearFocus,
  openCosts,
  recordActivity
}: {
  integrations: IntegrationItem[];
  setIntegrations: React.Dispatch<React.SetStateAction<IntegrationItem[]>>;
  focusIntegration: IntegrationName | null;
  clearFocus: () => void;
  openCosts: () => void;
  recordActivity: (label: string, status?: string) => void;
}) {
  const normalizedIntegrations = integrationOrder.map((name) => integrations.find((item) => item.name === name) ?? defaultIntegrations.find((item) => item.name === name)!);
  const firstIntegration = normalizedIntegrations[0]!;
  const [selectedIntegration, setSelectedIntegration] = React.useState<IntegrationName>(firstIntegration.name);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const selected = normalizedIntegrations.find((item) => item.name === selectedIntegration) ?? normalizedIntegrations[0]!;
  const readyCount = normalizedIntegrations.filter((item) => item.status === "Ready").length;
  const rules = [
    ["Gateways", normalizedIntegrations.some((item) => ["Stripe", "PayPal"].includes(item.name) && item.status === "Ready") ? "Ready" : "Setup", "blue"],
    ["Stores", normalizedIntegrations.some((item) => ["Shopify", "WooCommerce", "WordPress"].includes(item.name) && item.status === "Ready") ? "Ready" : "Setup", "green"],
    ["Shipping", normalizedIntegrations.find((item) => item.name === "Shipping Rules")?.status === "Ready" ? "Ready" : "Setup", "orange"],
    ["Ads", normalizedIntegrations.some((item) => ["Meta Ads", "TikTok Ads", "Google Ads"].includes(item.name) && item.status === "Ready") ? "Ready" : "Setup", "purple"]
  ] as const;

  React.useEffect(() => {
    if (!focusIntegration) return;
    setSelectedIntegration(focusIntegration);
    setSetupOpen(true);
    clearFocus();
  }, [clearFocus, focusIntegration]);

  async function saveIntegration(next: IntegrationItem) {
    if (next.name === "WooCommerce" || next.name === "WordPress") {
      const platformPath = next.name === "WooCommerce" ? "woocommerce" : "wordpress";
      await postJson<{ connected: boolean }>(`/stores/connect/${platformPath}`, {
        name: next.name,
        connectionToken: next.token,
        signingSecret: next.signingSecret ?? ""
      });
      setIntegrations(() => normalizedIntegrations.map((item) => item.name === next.name ? next : item));
      setSelectedIntegration(next.name);
      setSetupOpen(false);
      recordActivity(`${next.name} plugin saved.`, "Ready");
      return;
    }

    const result = await postJson<{ ok: boolean; message?: string }>("/integrations/validate", {
      name: next.name,
      endpoint: next.endpoint,
      token: next.token
    });
    if (!result.ok) {
      throw new Error(result.message ?? "Integration validation failed.");
    }

    setIntegrations(() => normalizedIntegrations.map((item) => item.name === next.name ? next : item));
    setSelectedIntegration(next.name);
    setSetupOpen(false);
    recordActivity(`${next.name} validated.`, "Ready");
  }

  async function disconnectIntegration(next: IntegrationItem) {
    if (!["Shopify", "WooCommerce", "WordPress"].includes(next.name)) return;
    const platformPath = next.name === "WooCommerce" ? "woocommerce" : next.name === "WordPress" ? "wordpress" : "shopify";
    await deleteJson<{ disconnected: boolean }>(`/stores/${platformPath}`);
    setIntegrations(() => normalizedIntegrations.map((item) => item.name === next.name ? {
      ...item,
      status: "Needs setup",
      endpoint: "",
      token: "",
      signingSecret: ""
    } : item));
    setSelectedIntegration(next.name);
    setSetupOpen(false);
    recordActivity(`${next.name} disconnected.`, "Done");
  }

  function openIntegration(item: IntegrationItem) {
    if (["Meta Ads", "TikTok Ads", "Google Ads", "Shipping Rules", "Manual Imports"].includes(item.name)) {
      openCosts();
      return;
    }
    setSelectedIntegration(item.name);
    setSetupOpen(true);
  }

  return (
    <>
      <PageTitle eyebrow="Plugin setup" title="Plugin Setup" />
      <section className="integrations-workspace">
        <div className="panel integration-group stores">
          <h2>Stores</h2>
          <div className="integration-card-grid store-card-grid">
            {normalizedIntegrations.filter((item) => ["Shopify", "WooCommerce", "WordPress"].includes(item.name)).map((item) => (
              <IntegrationCard key={item.name} item={item} action="Install" open={() => openIntegration(item)} />
            ))}
          </div>
        </div>
        <div className="panel integration-group payments">
          <h2>Payments</h2>
          <div className="integration-card-grid">
            {normalizedIntegrations.filter((item) => ["Stripe", "PayPal"].includes(item.name)).map((item) => (
              <IntegrationCard key={item.name} item={item} action="Validate" open={() => openIntegration(item)} />
            ))}
          </div>
        </div>
        <div className="panel integration-group channels">
          <h2>Costs</h2>
          <div className="integration-card-grid">
            {normalizedIntegrations.filter((item) => ["Meta Ads", "TikTok Ads", "Google Ads", "Shipping Rules", "Manual Imports"].includes(item.name)).map((item) => (
              <IntegrationCard key={item.name} item={item} action={item.name === "Shipping Rules" ? "Set Rules" : "Import"} open={() => openIntegration(item)} />
            ))}
          </div>
        </div>
        <div className="panel integration-group status-panel">
          <h2>Status</h2>
          <div className="rule-tile-grid">
            {rules.map(([label, value, tone]) => <RuleTile key={label} label={label} value={value} tone={tone} />)}
            <RuleTile label="Ready" value={`${readyCount}/${normalizedIntegrations.length}`} tone="red" />
          </div>
        </div>
      </section>
      {setupOpen ? <IntegrationSetupModal integration={selected} save={saveIntegration} disconnect={disconnectIntegration} close={() => setSetupOpen(false)} recordActivity={recordActivity} /> : null}
    </>
  );
}

function IntegrationCard({ item, action, open }: { item: IntegrationItem; action: string; open: () => void }) {
  return (
    <article className={`integration-card ${item.status === "Ready" ? "ready" : ""}`}>
      <div className="integration-card-top">
        <div className="integration-icon">{item.code}</div>
        <span className={item.status === "Ready" ? "connected" : "needs-setup"}>{item.status}</span>
      </div>
      <strong>{item.name}</strong>
      <button onClick={open}>{action}</button>
    </article>
  );
}

function IntegrationSetupModal({
  integration,
  save,
  disconnect,
  close,
  recordActivity
}: {
  integration: IntegrationItem;
  save: (integration: IntegrationItem) => Promise<void>;
  disconnect: (integration: IntegrationItem) => Promise<void>;
  close: () => void;
  recordActivity: (label: string, status?: string) => void;
}) {
  const isShopify = integration.name === "Shopify";
  const isWooCommerce = integration.name === "WooCommerce";
  const isWordPress = integration.name === "WordPress";
  const isPayment = ["Stripe", "PayPal"].includes(integration.name);
  const isPayPal = integration.name === "PayPal";
  const [endpoint, setEndpoint] = React.useState(() => {
    if (integration.endpoint) return integration.endpoint;
    if (integration.name === "Stripe") return "https://api.stripe.com";
    if (integration.name === "PayPal") return "https://api-m.paypal.com";
    return "";
  });
  const [clientId, setClientId] = React.useState(() => isPayPal && integration.token.includes(":") ? integration.token.split(":")[0] ?? "" : "");
  const [token, setToken] = React.useState(() => {
    if (isPayPal && integration.token.includes(":")) return integration.token.split(":").slice(1).join(":");
    return integration.token || (isWooCommerce || isWordPress ? `tmt_${window.crypto.randomUUID().replaceAll("-", "")}` : "");
  });
  const [signingSecret, setSigningSecret] = React.useState(() => integration.signingSecret || `whsec_${window.crypto.randomUUID().replaceAll("-", "")}`);
  const [error, setError] = React.useState("");
  const [copyStatus, setCopyStatus] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  function normalizeShopDomain(value: string) {
    return value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  }

  async function startShopifyOAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shop = normalizeShopDomain(endpoint);
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      setError("Enter a myshopify.com domain.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await postJson<{ installUrl: string; shop: string }>("/stores/connect/shopify/install-link", { shop });
      window.open(result.installUrl, "_blank", "noopener,noreferrer");
      recordActivity("Shopify install opened.", "Action");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Shopify install could not be opened.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPluginSettings(provider: "WooCommerce" | "WordPress") {
    const text = [
      `API URL: ${apiUrl}`,
      `Connection token: ${token || "Set a token first"}`,
      `Signing secret: ${signingSecret}`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
      recordActivity(`${provider} settings copied.`, "Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint.trim() || (isPayment && !token.trim()) || (isPayPal && !clientId.trim())) {
      setError(isPayPal ? "Client ID and secret are required." : isPayment ? "Secret is required." : "Store URL is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await save({
        ...integration,
        endpoint: endpoint.trim(),
        token: isPayPal ? `${clientId.trim()}:${token.trim()}` : token.trim(),
        status: "Ready"
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Integration validation failed.");
    } finally {
      setSaving(false);
    }
  }

  async function savePluginConnection() {
    if (!token.trim()) {
      setError("Connection token is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await save({
        ...integration,
        endpoint: apiUrl,
        token: token.trim(),
        signingSecret: signingSecret.trim(),
        status: "Ready"
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Plugin settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnectPluginConnection() {
    if (!window.confirm(`Disconnect ${integration.name}?`)) return;
    setSaving(true);
    setError("");
    try {
      await disconnect(integration);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Plugin could not be disconnected.");
    } finally {
      setSaving(false);
    }
  }

  if (isShopify) {
    return (
      <Modal title="Install Shopify" close={close}>
        <form className="stacked-form" onSubmit={startShopifyOAuth}>
          <label>
            <span>Shop domain</span>
            <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="store.myshopify.com" />
          </label>
          {error ? <div className="field-error" role="alert">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button type="submit">Start Install</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (isWooCommerce || isWordPress) {
    const provider = isWooCommerce ? "WooCommerce" : "WordPress";
    const fileName = isWooCommerce ? "true-margin-tracker-woocommerce.zip" : "true-margin-tracker-wordpress.zip";
    return (
      <Modal title={`Install ${provider} Plugin`} close={close}>
        <div className="stacked-form">
          <label>
            <span>API URL</span>
            <input value={apiUrl} readOnly />
          </label>
          <label>
            <span>Connection token</span>
            <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Create a token" />
          </label>
          <label>
            <span>Signing secret</span>
            <input value={signingSecret} onChange={(event) => setSigningSecret(event.target.value)} />
          </label>
          <div className="modal-actions">
            <a className="button-link" href={`/downloads/${fileName}`} download>Download Plugin</a>
            <button type="button" onClick={() => void copyPluginSettings(provider)}>Copy Settings</button>
            {integration.status === "Ready" ? <button type="button" className="danger-action" onClick={() => void disconnectPluginConnection()} disabled={saving}>Disconnect</button> : null}
            <button type="button" onClick={() => void savePluginConnection()} disabled={saving}>{saving ? "Saving" : "Save"}</button>
          </div>
          {copyStatus ? <div className={copyStatus === "Copied" ? "copy-status" : "field-error"} role="status">{copyStatus}</div> : null}
          {error ? <div className="field-error" role="alert">{error}</div> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Validate ${integration.name}`} close={close}>
      <form className="stacked-form" onSubmit={submit}>
        <label>
          <span>{isPayment ? "API URL" : "Endpoint"}</span>
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={integration.name === "Stripe" ? "https://api.stripe.com" : "https://api-m.paypal.com"} />
        </label>
        {isPayPal ? (
          <label>
            <span>Client ID</span>
            <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="PayPal client ID" />
          </label>
        ) : null}
        <label>
          <span>{isPayPal ? "Client secret" : "Secret"}</span>
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder={integration.name === "Stripe" ? "sk_live_..." : "Client secret"} />
        </label>
        {error ? <div className="field-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? "Validating" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function OrdersView({ orders, openIntegrations, deleteOrder }: { orders: OrderSummary[]; openIntegrations: () => void; deleteOrder: (order: OrderSummary) => void }) {
  return (
    <>
      <PageTitle eyebrow="Order-level profitability" title="Orders" action={<button onClick={openIntegrations}><Plug size={16} />Install Store</button>} />
      <section className="panel table-panel">
        {orders.length ? <OrderTable orders={orders} onDelete={deleteOrder} /> : (
          <EmptyState title="No orders" action="Install Shopify or WooCommerce to sync order history.">
            <button onClick={openIntegrations}><Plug size={16} />Install Plugin</button>
          </EmptyState>
        )}
      </section>
    </>
  );
}

function SettingsView({
  settings,
  setSettings,
  recordActivity
}: {
  settings: WorkspaceSettings;
  setSettings: React.Dispatch<React.SetStateAction<WorkspaceSettings>>;
  recordActivity: (label: string, status?: string) => void;
}) {
  const [team, setTeam] = React.useState<TeamPayload | null>(null);
  const [memberName, setMemberName] = React.useState("");
  const [memberEmail, setMemberEmail] = React.useState("");
  const [memberPassword, setMemberPassword] = React.useState("");
  const [memberRole, setMemberRole] = React.useState<"admin" | "member">("member");
  const [teamError, setTeamError] = React.useState("");
  const [teamSaving, setTeamSaving] = React.useState(false);
  const [apiKeys, setApiKeys] = React.useState<ApiKeyPayload | null>(null);
  const [apiKeyName, setApiKeyName] = React.useState("Reporting");
  const [apiKeyToken, setApiKeyToken] = React.useState("");
  const [apiKeyError, setApiKeyError] = React.useState("");
  const [apiKeySaving, setApiKeySaving] = React.useState(false);

  const loadTeam = React.useCallback(async () => {
    try {
      setTeam(await getJson<TeamPayload>("/team/members"));
    } catch (error) {
      setTeam({
        allowed: false,
        plan: "Starter",
        members: [],
        error: error instanceof Error ? error.message : "Team unavailable."
      });
    }
  }, []);

  const loadApiKeys = React.useCallback(async () => {
    try {
      setApiKeys(await getJson<ApiKeyPayload>("/api-keys"));
    } catch (error) {
      setApiKeys({
        allowed: false,
        plan: "Starter",
        keys: [],
        error: error instanceof Error ? error.message : "API unavailable."
      });
    }
  }, []);

  React.useEffect(() => {
    void loadTeam();
    void loadApiKeys();
  }, [loadApiKeys, loadTeam]);

  function updateSetting<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    try {
      await postJson<{ saved: boolean }>("/workspace/settings", settings);
      recordActivity("Settings saved.");
    } catch {
      recordActivity("Settings saved locally.", "Offline");
    }
  }

  async function addTeamMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTeamError("");
    setTeamSaving(true);
    try {
      await postJson<{ created: boolean; member: TeamMember }>("/team/members", {
        name: memberName,
        email: memberEmail,
        password: memberPassword,
        role: memberRole
      });
      setMemberName("");
      setMemberEmail("");
      setMemberPassword("");
      setMemberRole("member");
      await loadTeam();
      recordActivity("Team member added.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be added.");
    } finally {
      setTeamSaving(false);
    }
  }

  async function removeTeamMember(member: TeamMember) {
    if (!window.confirm(`Remove ${member.name}?`)) return;
    setTeamError("");
    try {
      await deleteJson<{ deleted: boolean }>(`/team/members/${encodeURIComponent(member.id)}`);
      await loadTeam();
      recordActivity("Team member removed.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be removed.");
    }
  }

  async function createApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiKeyError("");
    setApiKeySaving(true);
    setApiKeyToken("");
    try {
      const result = await postJson<{ created: boolean; token: string }>("/api-keys", { name: apiKeyName });
      setApiKeyToken(result.token);
      await loadApiKeys();
      recordActivity("API key created.");
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "API key could not be created.");
    } finally {
      setApiKeySaving(false);
    }
  }

  async function deleteApiKey(key: ApiKeySummary) {
    if (!window.confirm(`Delete ${key.name}?`)) return;
    setApiKeyError("");
    try {
      await deleteJson<{ deleted: boolean }>(`/api-keys/${encodeURIComponent(key.id)}`);
      await loadApiKeys();
      recordActivity("API key deleted.");
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "API key could not be deleted.");
    }
  }

  return (
    <>
      <PageTitle eyebrow="Workspace" title="Settings" action={<button className="settings-save-button" onClick={saveSettings}><Save size={16} />Save Settings</button>} />
      <section className="settings-grid compact-settings">
        <div className="panel settings-panel">
          <h2>Workspace</h2>
          <label><span>Store name</span><input value={settings.storeName} onChange={(event) => updateSetting("storeName", event.target.value)} placeholder="Main store" /></label>
          <label><span>Currency</span><select value={settings.currency} onChange={(event) => updateSetting("currency", event.target.value)}><option value="">Setup</option><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option><option>AUD</option></select></label>
          <label><span>Tax</span><select value={settings.taxMode} onChange={(event) => updateSetting("taxMode", event.target.value)}><option value="">Setup</option><option value="excluded">Excluded</option><option value="included">Included</option></select></label>
          <label><span>Language</span><select value={settings.language} onChange={(event) => updateSetting("language", event.target.value)}><option>English</option></select></label>
        </div>
        <div className="panel settings-panel">
          <h2>Alerts</h2>
          <ToggleRow label="Loss" checked={settings.alertLoss} onChange={(checked) => updateSetting("alertLoss", checked)} />
          <ToggleRow label="Costs" checked={settings.alertCosts} onChange={(checked) => updateSetting("alertCosts", checked)} />
          <ToggleRow label="Returns" checked={settings.alertReturns} onChange={(checked) => updateSetting("alertReturns", checked)} />
          <ToggleRow label="Email" checked={settings.alertEmail} onChange={(checked) => updateSetting("alertEmail", checked)} />
        </div>
        <div className="panel settings-panel team-panel">
          <h2>Team</h2>
          <div className={`team-state ${team?.allowed ? "ready" : ""}`}>
            <strong>{team?.allowed ? "Pro" : team?.plan ?? "Starter"}</strong>
            <small>{team?.allowed ? `${team.members.length} member${team.members.length === 1 ? "" : "s"}` : team?.error ?? "Loading"}</small>
          </div>
          <div className="team-list">
            {(team?.members ?? []).map((member) => (
              <div key={member.id} className="team-member-row">
                <span><strong>{member.name}</strong><small>{member.email}</small></span>
                <small>{member.role}</small>
                {member.role !== "owner" ? <button type="button" className="danger-action" onClick={() => void removeTeamMember(member)}>Remove</button> : null}
              </div>
            ))}
          </div>
          <form className="team-form" onSubmit={addTeamMember}>
            <label><span>Name</span><input value={memberName} onChange={(event) => setMemberName(event.target.value)} /></label>
            <label><span>Email</span><input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></label>
            <label><span>Role</span><select value={memberRole} onChange={(event) => setMemberRole(event.target.value as "admin" | "member")}><option value="member">Member</option><option value="admin">Admin</option></select></label>
            <label><span>Password</span><input type="password" value={memberPassword} onChange={(event) => setMemberPassword(event.target.value)} /></label>
            {teamError ? <div className="field-error" role="alert">{teamError}</div> : null}
            <button type="submit" disabled={teamSaving || !team?.allowed}>{teamSaving ? "Saving" : "Add Member"}</button>
          </form>
        </div>
        <div className="panel settings-panel api-panel">
          <h2>API</h2>
          <div className={`team-state ${apiKeys?.allowed ? "ready" : ""}`}>
            <strong>{apiKeys?.allowed ? "Pro" : apiKeys?.plan ?? "Starter"}</strong>
            <small>{apiKeys?.allowed ? `${apiKeys.keys.length} key${apiKeys.keys.length === 1 ? "" : "s"}` : apiKeys?.error ?? "Loading"}</small>
          </div>
          <div className="team-list">
            {(apiKeys?.keys ?? []).map((key) => (
              <div key={key.id} className="team-member-row">
                <span><strong>{key.name}</strong><small>{key.prefix}...</small></span>
                <small>{key.lastUsedAt ? "Used" : "New"}</small>
                <button type="button" className="danger-action" onClick={() => void deleteApiKey(key)}>Delete</button>
              </div>
            ))}
          </div>
          <form className="team-form api-key-form" onSubmit={createApiKey}>
            <label><span>Name</span><input value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} /></label>
            <button type="submit" disabled={apiKeySaving || !apiKeys?.allowed}>{apiKeySaving ? "Saving" : "Create Key"}</button>
            {apiKeyToken ? <div className="api-key-token"><strong>Token</strong><code>{apiKeyToken}</code></div> : null}
            {apiKeyError ? <div className="field-error" role="alert">{apiKeyError}</div> : null}
          </form>
        </div>
      </section>
    </>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function BillingView({
  billing,
  setBilling,
  activity,
  recordActivity
}: {
  billing: BillingState;
  setBilling: React.Dispatch<React.SetStateAction<BillingState>>;
  activity: ActivityItem[];
  recordActivity: (label: string, status?: string) => void;
}) {
  const visibleActivity = activity.filter((item) => !/ plan selected\.$/.test(item.label));
  const plans: Array<{ name: PlanName; price: string; tone: "blue" | "green" | "orange"; fit: string; features: string[] }> = [
    { name: "Starter", price: planPrice("Starter"), tone: "blue", fit: "One small store", features: ["1 connected store", "Up to 1,000 orders/mo", "Manual costs + CSV"] },
    { name: "Growth", price: planPrice("Growth"), tone: "green", fit: "Several sales channels", features: ["3 connected stores", "Up to 10,000 orders/mo", "Payment fees + exports"] },
    { name: "Pro", price: planPrice("Pro"), tone: "orange", fit: "Team or high volume", features: ["10 connected stores", "Up to 50,000 orders/mo", "API + team access"] }
  ];
  const [licenseError, setLicenseError] = React.useState("");
  const [activating, setActivating] = React.useState(false);

  function openPurchase(plan: PlanName) {
    try {
      const configuredPurchaseUrl = purchaseUrl.trim();
      if (!configuredPurchaseUrl) {
        setLicenseError("Purchase URL is not configured.");
        return;
      }
      const url = new URL(configuredPurchaseUrl, window.location.origin);
      url.searchParams.set("plan", plan.toLowerCase());
      if (billing.billingEmail.trim()) {
        url.searchParams.set("email", billing.billingEmail.trim());
      }
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      recordActivity(`${plan} purchase page opened.`, "Purchase");
    } catch {
      setLicenseError("Purchase URL is not configured.");
    }
  }

  async function activateLicense() {
    const licenseKey = billing.licenseKey.trim();
    if (!licenseKey) {
      setLicenseError("Enter a license key.");
      return;
    }

    setLicenseError("");
    setActivating(true);
    try {
      const result = await postJson<{ active: boolean; plan: PlanName; licenseId?: string }>("/license/activate", {
        licenseKey,
        ...(billing.billingEmail.trim() ? { billingEmail: billing.billingEmail.trim() } : {})
      });
      setBilling((current) => ({
        ...current,
        plan: result.plan,
        licenseStatus: result.active ? "Active" : "Inactive",
        licenseId: result.licenseId ?? ""
      }));
      recordActivity("License activated.", "Active");
    } catch (caughtError) {
      setLicenseError(caughtError instanceof Error ? caughtError.message : "License activation failed.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <>
      <PageTitle eyebrow="License" title="License" />
      <section className="billing-grid">
        <div className="panel billing-plans license-plans">
          <h2>Plans</h2>
          <div className="plan-grid">
            {plans.map((plan) => {
              const activePlan = billing.licenseStatus === "Active" && billing.plan === plan.name;
              return (
                <article className={`plan-card ${plan.tone} ${activePlan ? "active" : ""}`} key={plan.name}>
                  <div className="plan-card-header">
                    <span>{plan.name}</span>
                    <strong>{plan.price}</strong>
                  </div>
                  <p>{plan.fit}</p>
                  <ul className="plan-features">
                    {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  <button onClick={() => openPurchase(plan.name)}>
                    {activePlan ? "Manage" : "Buy"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
        <div className="panel settings-panel license-panel">
          <h2>Activation</h2>
          <div className={`license-state ${billing.licenseStatus === "Active" ? "active" : ""}`}>
            <span>Status</span>
            <strong>{billing.licenseStatus}</strong>
            <small>{billing.licenseStatus === "Active" ? billing.plan : "Key required"}</small>
          </div>
          <label><span>Account email</span><input type="email" value={billing.billingEmail} onChange={(event) => { setLicenseError(""); setBilling((current) => ({ ...current, billingEmail: event.target.value })); }} placeholder="owner@company.com" /></label>
          <label><span>License key</span><input value={billing.licenseKey} onChange={(event) => { setLicenseError(""); setBilling((current) => ({ ...current, licenseKey: event.target.value, licenseStatus: current.licenseStatus === "Active" ? "Inactive" : current.licenseStatus })); }} placeholder="TMT-..." /></label>
          {licenseError ? <div className="field-error" role="alert">{licenseError}</div> : null}
          <button onClick={() => void activateLicense()} disabled={activating}>{activating ? "Activating" : "Activate License"}</button>
        </div>
        <div className="panel owner-bridge-panel">
          <h2>Owner Checkout</h2>
          <div className="owner-bridge-row">
            <span>WooCommerce sales site</span>
            <strong>License Bridge</strong>
            <a className="button-link" href="/downloads/true-margin-tracker-license-bridge.zip" download><Download size={16} />Download Bridge</a>
          </div>
        </div>
        <div className="panel activity-panel">
          <h2>Activity</h2>
          {visibleActivity.length ? (
            <div className="activity-list">
              {visibleActivity.slice(0, 8).map((item) => (
                <div key={item.id} className="activity-row">
                  <span>{item.status}</span>
                  <strong>{item.label}</strong>
                  <small>{item.at}</small>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No activity" action="Open a purchase page or activate a license" />}
        </div>
      </section>
    </>
  );
}

function ProductTable({ products, openProduct, compact = false, onDelete }: { products: ProductSummary[]; openProduct: (id: string) => void; compact?: boolean; onDelete?: (product: ProductSummary) => void }) {
  const showActions = !compact && Boolean(onDelete);
  return (
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>Revenue</th>
          <th>Real Margin</th>
          <th>Margin %</th>
          <th>Ad Cost</th>
          <th>Shipping</th>
          {!compact ? <th>Fees</th> : null}
          {!compact ? <th>Returns</th> : null}
          <th>Status</th>
          {showActions ? <th>Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {products.map((item) => {
          const catalog = isCatalogProduct(item);
          return (
            <tr key={item.id} onClick={() => openProduct(item.id)}>
              <td><span className={`thumb ${item.image}`}></span><span><strong>{item.title}</strong><small>{item.sku}</small></span></td>
              <td>{catalog ? "No orders" : money(item.margin.revenueNetMinor)}</td>
              <td className={item.margin.trueMarginMinor < 0 ? "negative" : "positive"}>{catalog ? `Projected ${money(item.margin.trueMarginMinor)}` : money(item.margin.trueMarginMinor)}</td>
              <td>{catalog ? `Projected ${percent(item.margin.trueMarginPercent)}` : percent(item.margin.trueMarginPercent)}</td>
              <td>{catalog ? "No orders" : money(item.adCostMinor)}</td>
              <td>{catalog ? "No orders" : money(item.shippingCostMinor)}</td>
              {!compact ? <td>{catalog ? "No orders" : money(item.feesMinor)}</td> : null}
              {!compact ? <td>{catalog ? "No orders" : money(item.returnsMinor)}</td> : null}
              <td><span className={`status ${catalog ? "unknown" : item.margin.status}`}>{catalog ? "Catalog" : statusLabel(item.margin.status)}</span></td>
              {showActions ? (
                <td>
                  <button
                    className="danger-action"
                    aria-label={`Delete ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(item);
                    }}
                  >
                    <Trash2 size={15} />Delete
                  </button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OrderTable({ orders, onDelete }: { orders: OrderSummary[]; onDelete?: (order: OrderSummary) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Channel</th>
          <th>Customer</th>
          <th>Placed</th>
          <th>Revenue</th>
          <th>Real Margin</th>
          <th>Margin %</th>
          <th>Status</th>
          {onDelete ? <th>Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <td><strong>{order.sourceOrderId}</strong></td>
            <td>{order.channel}</td>
            <td>{order.customer}</td>
            <td>{order.placedAt}</td>
            <td>{money(order.revenueMinor)}</td>
            <td className={order.trueMarginMinor < 0 ? "negative" : "positive"}>{money(order.trueMarginMinor)}</td>
            <td>{percent(order.trueMarginPercent)}</td>
            <td><span className={`status ${order.status}`}>{statusLabel(order.status)}</span></td>
            {onDelete ? (
              <td>
                <button className="danger-action" aria-label={`Delete order ${order.sourceOrderId}`} onClick={() => onDelete(order)}>
                  <Trash2 size={15} />Delete
                </button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrendPanel({ title = "Profitability Trend" }: { title?: string }) {
  return (
    <div className="panel trend-panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <EmptyState title="No trend" action="Sync historical data" />
    </div>
  );
}

function CostBreakdownPanel({ metrics }: { metrics: OverviewPayload["metrics"] }) {
  return (
    <div className="panel cost-panel">
      <div className="panel-header"><h2>Cost Breakdown</h2></div>
      <div className="donut-wrap">
        <div className="donut"><div className="donut-center"><strong>{money(metrics.adCostMinor + metrics.shippingCostMinor + metrics.feesMinor + metrics.returnCostMinor)}</strong><span>Total Costs</span></div></div>
        <ul className="legend">
          <li><i className="blue"></i>Ad Cost <strong>{money(metrics.adCostMinor)}</strong></li>
          <li><i className="green"></i>Shipping <strong>{money(metrics.shippingCostMinor)}</strong></li>
          <li><i className="orange"></i>Fees <strong>{money(metrics.feesMinor)}</strong></li>
          <li><i className="red"></i>Returns <strong>{money(metrics.returnCostMinor)}</strong></li>
        </ul>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, delta, tone }: { icon: React.ReactNode; label: string; value: string; delta: string; tone: "green" | "red" | "orange" | "blue" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small className={tone}>{delta}</small>
      </div>
      <div className={`metric-icon ${tone}`}>{icon}</div>
    </article>
  );
}

function Insight({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <div className="insight-row">
      <div className="metric-icon blue">{icon}</div>
      <div><span>{title}</span><strong>{value}</strong></div>
    </div>
  );
}

function Rule({ title, value }: { title: string; value: string }) {
  return (
    <div className="rule-row">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RuleTile({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "orange" | "purple" | "red" }) {
  return (
    <div className={`rule-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RuleInput({ title, value, onChange, suffix }: { title: string; value: string; onChange: (value: string) => void; suffix: string }) {
  return (
    <label className="rule-row rule-input">
      <span>{title}</span>
      <strong><input value={value} onChange={(event) => onChange(event.target.value)} /> <small>{suffix}</small></strong>
    </label>
  );
}

function SettingRow({ label, value, extra }: { label: string; value: string; extra: string }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{extra}</small>
    </div>
  );
}

function HealthRow({ ok = false, label }: { ok?: boolean; label: string }) {
  return (
    <div className={`health-row ${ok ? "ok" : "issue"}`}>
      {ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      <span>{label}</span>
    </div>
  );
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{title}</h2>
          <button onClick={close} aria-label="Close"><XCircle size={16} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function EmptyState({ title, action, children }: { title: string; action: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{action}</span>
      {children}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
