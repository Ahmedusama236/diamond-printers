import { useEffect, useMemo, useState } from "react";
import { api, buildQuery } from "./api";
import { t as tr } from "./i18n";

const TABS = [
  "suppliers",
  "components",
  "purchases",
  "productsBom",
  "manufacturing",
  "sales",
  "damaged",
  "maintenance",
  "shortage",
  "reports",
  "settings",
];

function blankSupplier() {
  return { id: null, name: "", phone: "", email: "" };
}

function blankComponent() {
  return {
    id: null,
    item_name: "",
    stock_qty: 0,
    minimum_stock_qty: "",
    supplier_id: "",
    purchase_link: "",
    price_egp: "",
  };
}

function blankIntake() {
  return {
    name: "",
    qty: 1,
    existing_component_id: "",
    supplier_id: "",
    purchase_link: "",
    price_egp: "",
    minimum_stock_qty: "",
    received_at: nowLocalDateTimeValue(),
  };
}

function blankProduct() {
  return { id: null, name: "" };
}

function blankManufacturing() {
  return { id: null, product_id: "", units_produced: 1, produced_at: nowLocalDateTimeValue() };
}

function blankSale() {
  return {
    id: null,
    product_id: "",
    units_sold: 1,
    unit_sell_price_egp: 5500,
    manufacturing_cost_per_unit: 1000,
    sold_at: nowLocalDateTimeValue(),
  };
}

function blankDamage() {
  return { id: null, component_id: "", qty_damaged: 1, damaged_at: nowLocalDateTimeValue() };
}

function blankMaintenanceTicket() {
  return {
    customer_name: "",
    phone: "",
    device_issue: "",
    opened_at: nowLocalDateTimeValue(),
  };
}

function blankPurchaseEdit() {
  return {
    id: null,
    component_id: "",
    qty_received: 1,
    supplier_id: "",
    purchase_link: "",
    price_egp: "",
    received_at: nowLocalDateTimeValue(),
  };
}

function blankLoginForm() {
  return { username: "ahmed", password: "123456789" };
}

function toLocalDateTimeValue(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function nowLocalDateTimeValue() {
  return toLocalDateTimeValue(new Date().toISOString());
}

function nowLocalDateValue() {
  const date = new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function App() {
  const [language, setLanguage] = useState("en");
  const [activeTab, setActiveTab] = useState("components");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState(blankLoginForm());
  const [loginError, setLoginError] = useState("");

  const [suppliers, setSuppliers] = useState([]);
  const [components, setComponents] = useState([]);
  const [products, setProducts] = useState([]);
  const [bomItems, setBomItems] = useState([]);
  const [manufacturingRecords, setManufacturingRecords] = useState([]);
  const [salesRecords, setSalesRecords] = useState([]);
  const [damageRecords, setDamageRecords] = useState([]);
  const [shortages, setShortages] = useState([]);
  const [maintenanceTickets, setMaintenanceTickets] = useState([]);
  const [shortageSupplierId, setShortageSupplierId] = useState("");

  const [selectedProductId, setSelectedProductId] = useState("");

  const [supplierForm, setSupplierForm] = useState(blankSupplier());
  const [componentForm, setComponentForm] = useState(blankComponent());
  const [intakeForm, setIntakeForm] = useState(blankIntake());
  const [productForm, setProductForm] = useState(blankProduct());
  const [bomForm, setBomForm] = useState({ component_id: "", qty_per_unit: 1 });
  const [manufacturingForm, setManufacturingForm] = useState(blankManufacturing());
  const [saleForm, setSaleForm] = useState(blankSale());
  const [damageForm, setDamageForm] = useState(blankDamage());

  const [searchMatches, setSearchMatches] = useState([]);
  const [purchaseHistoryRows, setPurchaseHistoryRows] = useState([]);
  const [purchaseHistoryItem, setPurchaseHistoryItem] = useState("");
  const [purchaseHistoryComponentId, setPurchaseHistoryComponentId] = useState(null);
  const [purchaseEditForm, setPurchaseEditForm] = useState(blankPurchaseEdit());
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryMatches, setInventoryMatches] = useState([]);
  const [inventoryItem, setInventoryItem] = useState(null);
  const [reportParams, setReportParams] = useState({
    period: "daily",
    date: nowLocalDateValue(),
    start_date: "",
    end_date: "",
  });
  const [reportData, setReportData] = useState(null);

  const t = (key) => tr(language, key);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (intakeForm.name.trim().length < 1) {
        setSearchMatches([]);
        return;
      }
      api
        .get(`/components/search${buildQuery({ q: intakeForm.name })}`)
        .then((rows) => setSearchMatches(rows))
        .catch(() => setSearchMatches([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [intakeForm.name]);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    const normalizedName = intakeForm.name.trim().toLowerCase();
    if (!normalizedName) {
      if (intakeForm.existing_component_id) {
        setIntakeForm((s) => ({ ...s, existing_component_id: "" }));
      }
      return;
    }

    const exactMatch = searchMatches.find(
      (m) => m.item_name.trim().toLowerCase() === normalizedName
    );
    const nextId = exactMatch ? String(exactMatch.id) : "";
    if (nextId !== String(intakeForm.existing_component_id || "")) {
      setIntakeForm((s) => ({ ...s, existing_component_id: nextId }));
    }
  }, [searchMatches, intakeForm.name, intakeForm.existing_component_id]);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (inventoryQuery.trim().length < 1) {
        setInventoryMatches([]);
        return;
      }
      api
        .get(`/inventory/search${buildQuery({ q: inventoryQuery })}`)
        .then((rows) => setInventoryMatches(rows))
        .catch(() => setInventoryMatches([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [inventoryQuery]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refreshStock = async () => {
      try {
        const [componentsPayload, shortagePayload] = await Promise.all([
          api.get("/components"),
          api.get("/shortages"),
        ]);
        setComponents(componentsPayload);
        setShortages(shortagePayload);
      } catch (e) {
        if (e?.status === 401) setIsAuthenticated(false);
      }
    };
    const interval = setInterval(refreshStock, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (!selectedProductId) {
      setBomItems([]);
      return;
    }
    api
      .get(`/products/${selectedProductId}/bom`)
      .then((rows) => setBomItems(rows))
      .catch((e) => setError(e.message));
  }, [selectedProductId]);

  function handleRequestError(e) {
    if (e?.status === 401) {
      setIsAuthenticated(false);
      setAuthChecked(true);
      setLoginError(t("sessionExpired"));
      setError("");
      setInfo("");
      return true;
    }
    return false;
  }

  async function checkAuthStatus() {
    setBusy(true);
    try {
      const payload = await api.get("/auth/status");
      const authenticated = Boolean(payload.authenticated);
      setIsAuthenticated(authenticated);
      setAuthChecked(true);
      setLoginError("");
      if (authenticated) {
        await initialize();
      }
    } catch (e) {
      setAuthChecked(true);
      if (!handleRequestError(e)) {
        setLoginError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    setError("");
    try {
      const [langPayload, suppliersPayload, componentsPayload, productsPayload] =
        await Promise.all([
          api.get("/settings/language"),
          api.get("/suppliers"),
          api.get("/components"),
          api.get("/products"),
        ]);
      setLanguage(langPayload.language || "en");
      setSuppliers(suppliersPayload);
      setComponents(componentsPayload);
      setProducts(productsPayload);
      await Promise.all([
        refreshManufacturing(),
        refreshSales(),
        refreshDamaged(),
        refreshShortages(),
        refreshMaintenance(),
      ]);
    } catch (e) {
      if (!handleRequestError(e)) {
        setError(e.message);
      }
    }
  }

  async function refreshBasics() {
    const [suppliersPayload, componentsPayload, productsPayload] = await Promise.all([
      api.get("/suppliers"),
      api.get("/components"),
      api.get("/products"),
    ]);
    setSuppliers(suppliersPayload);
    setComponents(componentsPayload);
    setProducts(productsPayload);
  }

  async function refreshManufacturing() {
    const rows = await api.get("/manufacturing-records");
    setManufacturingRecords(rows);
  }

  async function refreshSales() {
    const rows = await api.get("/sales-records");
    setSalesRecords(rows);
  }

  async function refreshDamaged() {
    const rows = await api.get("/damage-records");
    setDamageRecords(rows);
  }

  async function refreshShortages() {
    const rows = await api.get("/shortages");
    setShortages(rows);
  }

  async function refreshMaintenance() {
    const rows = await api.get("/maintenance-tickets");
    setMaintenanceTickets(rows);
  }

  async function run(action) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await action();
    } catch (e) {
      if (!handleRequestError(e)) {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setLoginError("");
    setError("");
    try {
      await api.post("/auth/login", loginForm);
      setIsAuthenticated(true);
      await initialize();
    } catch (err) {
      setIsAuthenticated(false);
      setLoginError(err.message);
    } finally {
      setAuthChecked(true);
      setBusy(false);
    }
  }

  async function handleLogout() {
    await run(async () => {
      await api.post("/auth/logout");
      setIsAuthenticated(false);
      setLoginForm(blankLoginForm());
      clearForms();
      setReportData(null);
      setLoginError("");
    });
  }

  const sortedComponents = useMemo(
    () => [...components].sort((a, b) => a.item_name.localeCompare(b.item_name)),
    [components]
  );

  const reportQuery = useMemo(() => {
    const base = { period: reportParams.period };
    if (
      reportParams.period === "daily" ||
      reportParams.period === "weekly" ||
      reportParams.period === "monthly" ||
      reportParams.period === "yearly" ||
      reportParams.period === "specific_day"
    ) {
      base.date = reportParams.date;
    }
    if (reportParams.period === "date_range") {
      base.start_date = reportParams.start_date;
      base.end_date = reportParams.end_date;
    }
    return buildQuery(base);
  }, [reportParams]);

  function clearForms() {
    setSupplierForm(blankSupplier());
    setComponentForm(blankComponent());
    setIntakeForm(blankIntake());
    setProductForm(blankProduct());
    setBomForm({ component_id: "", qty_per_unit: 1 });
    setManufacturingForm(blankManufacturing());
    setSaleForm(blankSale());
    setDamageForm(blankDamage());
    setPurchaseHistoryRows([]);
    setPurchaseHistoryItem("");
    setPurchaseHistoryComponentId(null);
    setPurchaseEditForm(blankPurchaseEdit());
    setInventoryQuery("");
    setInventoryMatches([]);
    setInventoryItem(null);
  }

  if (!authChecked) {
    return <div className="app">{busy && <div className="notice">{t("checkingSession")}</div>}</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="loginShell">
        <section className="loginCard">
          <p className="loginEyebrow">{t("loginRequired")}</p>
          <h1>{t("appTitle")}</h1>
          <p className="subtitle">EGP | Africa/Cairo</p>
          {loginError && <div className="error">{loginError}</div>}
          <form className="loginForm" onSubmit={handleLoginSubmit}>
            <input
              placeholder={t("username")}
              value={loginForm.username}
              onChange={(e) => setLoginForm((s) => ({ ...s, username: e.target.value }))}
            />
            <input
              type="password"
              placeholder={t("password")}
              value={loginForm.password}
              onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value }))}
            />
            <button type="submit" disabled={busy}>
              {busy ? t("signingIn") : t("login")}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t("appTitle")}</h1>
          <p className="subtitle">EGP | Africa/Cairo</p>
        </div>
        <div className="topbarActions">
          <div className="langSwitch">
            <label>{t("lang")}</label>
            <select
              value={language}
              onChange={(e) => {
                const next = e.target.value;
                run(async () => {
                  await api.put("/settings/language", { language: next });
                  setLanguage(next);
                  setInfo(t("languageSaved"));
                });
              }}
            >
              <option value="en">{t("english")}</option>
              <option value="ar">{t("arabic")}</option>
            </select>
          </div>
          <button type="button" onClick={handleLogout}>
            {t("logout")}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={
              activeTab === tab || (tab === "components" && activeTab === "inventory")
                ? "tab active"
                : "tab"
            }
            onClick={() => setActiveTab(tab)}
          >
            {t(tab)}
          </button>
        ))}
      </nav>

      {busy && <div className="notice">{language === "ar" ? "جاري التحميل..." : "Loading..."}</div>}
      {error && <div className="error">{error}</div>}
      {info && <div className="info">{info}</div>}

      <main>
        {activeTab === "suppliers" && (
          <section>
            <SectionHeader
              title={t("suppliers")}
              actionLabel={`＋ ${t("create")}`}
              onAction={() => {
                setSupplierForm(blankSupplier());
                setShowSupplierForm(true);
              }}
            />
            {(showSupplierForm || supplierForm.id) && (
            <Modal
              title={`${supplierForm.id ? t("edit") : t("create")} ${t("suppliers")}`}
              onClose={() => {
                setSupplierForm(blankSupplier());
                setShowSupplierForm(false);
              }}
            >
            <form
              className="gridForm"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const payload = {
                    name: supplierForm.name,
                    phone: supplierForm.phone,
                    email: supplierForm.email,
                  };
                  if (supplierForm.id) {
                    await api.put(`/suppliers/${supplierForm.id}`, payload);
                  } else {
                    await api.post("/suppliers", payload);
                  }
                  setSupplierForm(blankSupplier());
                  setShowSupplierForm(false);
                  await refreshBasics();
                });
              }}
            >
              <input
                placeholder={t("name")}
                value={supplierForm.name}
                onChange={(e) => setSupplierForm((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                placeholder={t("phone")}
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm((s) => ({ ...s, phone: e.target.value }))}
              />
              <input
                placeholder={t("email")}
                value={supplierForm.email}
                onChange={(e) => setSupplierForm((s) => ({ ...s, email: e.target.value }))}
              />
              <button type="submit">{supplierForm.id ? t("update") : t("create")}</button>
              <button type="button" onClick={() => {
                setSupplierForm(blankSupplier());
                setShowSupplierForm(false);
              }}>
                {t("cancel")}
              </button>
            </form>
            </Modal>
            )}

            <DataTable
              columns={[t("name"), t("phone"), t("email"), t("actions")]}
              rows={suppliers}
              emptyText={t("noData")}
              renderRow={(s) => (
                <>
                  <td>{s.name}</td>
                  <td>{s.phone || "-"}</td>
                  <td>{s.email || "-"}</td>
                  <td>
                    <button onClick={() => setSupplierForm(s)}>{t("edit")}</button>
                    <button
                      className="danger"
                      onClick={() =>
                        run(async () => {
                          await api.delete(`/suppliers/${s.id}`);
                          await refreshBasics();
                        })
                      }
                    >
                      {t("delete")}
                    </button>
                  </td>
                </>
              )}
            />
          </section>
        )}

        {activeTab === "components" && (
          <section>
            <SectionHeader
              title={t("components")}
            />
            <div className="subTabs">
              <button type="button" className="active">{t("components")}</button>
              <button type="button" onClick={() => setActiveTab("inventory")}>{t("inventory")}</button>
            </div>
            {componentForm.id && (
              <Modal
                title={`${t("edit")} ${t("components")}`}
                onClose={() => setComponentForm(blankComponent())}
              >
                <form
                  className="gridForm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      const payload = {
                        item_name: componentForm.item_name,
                        stock_qty: Number(componentForm.stock_qty),
                        minimum_stock_qty:
                          componentForm.minimum_stock_qty === ""
                            ? null
                            : Number(componentForm.minimum_stock_qty),
                        supplier_id: componentForm.supplier_id || null,
                        purchase_link: componentForm.purchase_link || null,
                        price_egp:
                          componentForm.price_egp === "" ? undefined : Number(componentForm.price_egp),
                      };
                      await api.put(`/components/${componentForm.id}`, payload);
                      setComponentForm(blankComponent());
                      await refreshBasics();
                      await refreshShortages();
                    });
                  }}
                >
                  <input
                    placeholder={t("itemName")}
                    value={componentForm.item_name}
                    onChange={(e) => setComponentForm((s) => ({ ...s, item_name: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder={t("stockQty")}
                    value={componentForm.stock_qty}
                    onChange={(e) => setComponentForm((s) => ({ ...s, stock_qty: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder={t("minimumStock")}
                    value={componentForm.minimum_stock_qty ?? ""}
                    onChange={(e) =>
                      setComponentForm((s) => ({ ...s, minimum_stock_qty: e.target.value }))
                    }
                  />
                  <select
                    value={componentForm.supplier_id}
                    onChange={(e) => setComponentForm((s) => ({ ...s, supplier_id: e.target.value }))}
                  >
                    <option value="">{t("supplier")}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder={t("purchaseLink")}
                    value={componentForm.purchase_link}
                    onChange={(e) => setComponentForm((s) => ({ ...s, purchase_link: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("priceEgp")}
                    value={componentForm.price_egp}
                    onChange={(e) => setComponentForm((s) => ({ ...s, price_egp: e.target.value }))}
                  />
                  <button type="submit">{t("update")}</button>
                  <button type="button" onClick={() => setComponentForm(blankComponent())}>
                    {t("cancel")}
                  </button>
                </form>
              </Modal>
            )}

            {showIntakeForm && (
            <Modal title={t("intake")} onClose={() => {
              setIntakeForm(blankIntake());
              setSearchMatches([]);
              setShowIntakeForm(false);
            }}>
            <form
              className="gridForm"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const normalizedName = intakeForm.name.trim().toLowerCase();
                  const exactMatch = searchMatches.find(
                    (m) => m.item_name.trim().toLowerCase() === normalizedName
                  );
                  const existingComponentId = intakeForm.existing_component_id || exactMatch?.id;
                  await api.post("/components/intake", {
                    name: intakeForm.name,
                    qty: Number(intakeForm.qty),
                    decision: existingComponentId ? "existing" : "new",
                    existing_component_id: existingComponentId || undefined,
                    supplier_id: intakeForm.supplier_id || undefined,
                    purchase_link: intakeForm.purchase_link || undefined,
                    price_egp: intakeForm.price_egp ? Number(intakeForm.price_egp) : undefined,
                    minimum_stock_qty:
                      intakeForm.minimum_stock_qty === ""
                        ? undefined
                        : Number(intakeForm.minimum_stock_qty),
                    received_at: intakeForm.received_at || undefined,
                  });
                  setIntakeForm(blankIntake());
                  setSearchMatches([]);
                  setShowIntakeForm(false);
                  await refreshBasics();
                  await refreshShortages();
                });
              }}
            >
              <input
                list="component-name-suggestions"
                placeholder={t("itemName")}
                value={intakeForm.name}
                onChange={(e) =>
                  setIntakeForm((s) => ({
                    ...s,
                    name: e.target.value,
                    existing_component_id: "",
                  }))
                }
              />
              <datalist id="component-name-suggestions">
                {searchMatches.map((m) => (
                  <option key={m.id} value={m.item_name} />
                ))}
              </datalist>
              <input
                type="number"
                min="1"
                value={intakeForm.qty}
                onChange={(e) => setIntakeForm((s) => ({ ...s, qty: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                placeholder={t("minimumStock")}
                value={intakeForm.minimum_stock_qty}
                onChange={(e) =>
                  setIntakeForm((s) => ({ ...s, minimum_stock_qty: e.target.value }))
                }
              />
              <select
                value={intakeForm.supplier_id}
                onChange={(e) => setIntakeForm((s) => ({ ...s, supplier_id: e.target.value }))}
              >
                <option value="">{t("supplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("purchaseLink")}
                value={intakeForm.purchase_link}
                onChange={(e) => setIntakeForm((s) => ({ ...s, purchase_link: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={t("priceEgp")}
                value={intakeForm.price_egp}
                onChange={(e) => setIntakeForm((s) => ({ ...s, price_egp: e.target.value }))}
              />
              <input
                type="datetime-local"
                value={intakeForm.received_at}
                onChange={(e) => setIntakeForm((s) => ({ ...s, received_at: e.target.value }))}
              />
              <button type="submit">{t("save")}</button>
            </form>
            </Modal>
            )}

            <DataTable
              columns={[
                t("itemName"),
                t("stockQty"),
                t("minimumStock"),
                t("supplier"),
                t("latestPrice"),
                t("purchaseLink"),
                t("actions"),
              ]}
              rows={sortedComponents}
              emptyText={t("noData")}
              renderRow={(c) => (
                <>
                  <td>{c.item_name}</td>
                  <td>{c.stock_qty}</td>
                  <td>
                    {c.minimum_stock_qty ?? `${t("automaticFromBom")} (${c.effective_minimum_stock_qty})`}
                  </td>
                  <td>{c.supplier_name || "-"}</td>
                  <td>{c.latest_price_egp ?? "-"}</td>
                  <td>{c.purchase_link ? <PurchaseLink href={c.purchase_link} label={t("openPurchaseLink")} /> : "-"}</td>
                  <td>
                    <button onClick={() => setComponentForm({ ...c, price_egp: "" })}>{t("edit")}</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const rows = await api.get(`/components/${c.id}/purchase-history`);
                          setPurchaseHistoryRows(rows);
                          setPurchaseHistoryItem(c.item_name);
                          setPurchaseHistoryComponentId(c.id);
                          setPurchaseEditForm(blankPurchaseEdit());
                        })
                      }
                    >
                      {t("purchaseHistory")}
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        run(async () => {
                          await api.delete(`/components/${c.id}`);
                          await refreshBasics();
                        })
                      }
                    >
                      {t("delete")}
                    </button>
                  </td>
                </>
              )}
            />

            {purchaseHistoryComponentId !== null && (
              <Modal
                title={`${t("purchaseHistory")}: ${purchaseHistoryItem}`}
                onClose={() => {
                  setPurchaseHistoryComponentId(null);
                  setPurchaseHistoryRows([]);
                  setPurchaseEditForm(blankPurchaseEdit());
                }}
                wide
              >
                <DataTable
                  columns={[
                    t("qtyReceived"),
                    t("priceEgp"),
                    t("supplier"),
                    t("purchaseLink"),
                    t("receivedAt"),
                    t("actions"),
                  ]}
                  rows={purchaseHistoryRows}
                  emptyText={t("noData")}
                  renderRow={(p) => (
                    <>
                      <td>{p.qty_received}</td>
                      <td>{p.price_egp}</td>
                      <td>{p.supplier_name || "-"}</td>
                      <td>{p.purchase_link ? <PurchaseLink href={p.purchase_link} label={t("openPurchaseLink")} /> : "-"}</td>
                      <td>{new Date(p.received_at).toLocaleString()}</td>
                      <td>
                        <button
                          onClick={() =>
                            setPurchaseEditForm({
                              id: p.id,
                              component_id: String(p.component_id),
                              qty_received: p.qty_received,
                              supplier_id: p.supplier_id ? String(p.supplier_id) : "",
                              purchase_link: p.purchase_link || "",
                              price_egp: p.price_egp ?? "",
                              received_at: toLocalDateTimeValue(p.received_at),
                            })
                          }
                        >
                          {t("edit")}
                        </button>
                        <button
                          className="danger"
                          onClick={() =>
                            run(async () => {
                              await api.delete(`/components/intake-records/${p.id}`);
                              const rows = await api.get(
                                `/components/${purchaseHistoryComponentId}/purchase-history`
                              );
                              setPurchaseHistoryRows(rows);
                              setPurchaseEditForm(blankPurchaseEdit());
                              await refreshBasics();
                              await refreshShortages();
                            })
                          }
                        >
                          {t("deleteInvoice")}
                        </button>
                      </td>
                    </>
                  )}
                />

                {purchaseEditForm.id && (
                  <>
                    <h3>{t("edit")} {t("purchaseHistory")}</h3>
                    <form
                      className="gridForm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          await api.put(`/components/intake-records/${purchaseEditForm.id}`, {
                            component_id: Number(purchaseEditForm.component_id),
                            qty_received: Number(purchaseEditForm.qty_received),
                            supplier_id: purchaseEditForm.supplier_id || null,
                            purchase_link: purchaseEditForm.purchase_link || null,
                            price_egp:
                              purchaseEditForm.price_egp === ""
                                ? null
                                : Number(purchaseEditForm.price_egp),
                            received_at: purchaseEditForm.received_at || undefined,
                          });
                          setPurchaseEditForm(blankPurchaseEdit());
                          const rows = await api.get(
                            `/components/${purchaseHistoryComponentId}/purchase-history`
                          );
                          setPurchaseHistoryRows(rows);
                          await refreshBasics();
                          await refreshShortages();
                        });
                      }}
                    >
                      <select
                        value={purchaseEditForm.component_id}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, component_id: e.target.value }))
                        }
                      >
                        <option value="">{t("components")}</option>
                        {components.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.item_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={purchaseEditForm.qty_received}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, qty_received: e.target.value }))
                        }
                      />
                      <select
                        value={purchaseEditForm.supplier_id}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, supplier_id: e.target.value }))
                        }
                      >
                        <option value="">{t("supplier")}</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder={t("purchaseLink")}
                        value={purchaseEditForm.purchase_link}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, purchase_link: e.target.value }))
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={t("priceEgp")}
                        value={purchaseEditForm.price_egp}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, price_egp: e.target.value }))
                        }
                      />
                      <input
                        type="datetime-local"
                        value={purchaseEditForm.received_at}
                        onChange={(e) =>
                          setPurchaseEditForm((s) => ({ ...s, received_at: e.target.value }))
                        }
                      />
                      <button type="submit">{t("update")}</button>
                      <button type="button" onClick={() => setPurchaseEditForm(blankPurchaseEdit())}>
                        {t("cancel")}
                      </button>
                    </form>
                  </>
                )}
              </Modal>
            )}
          </section>
        )}

        {activeTab === "purchases" && (
          <PurchasesTab
            t={t}
            suppliers={suppliers}
            components={components}
            run={run}
            api={api}
            refreshAll={async () => {
              await Promise.all([refreshBasics(), refreshShortages()]);
            }}
          />
        )}

        {activeTab === "productsBom" && (
          <ProductsBomTab
            t={t}
            products={products}
            components={components}
            selectedProductId={selectedProductId}
            setSelectedProductId={setSelectedProductId}
            productForm={productForm}
            setProductForm={setProductForm}
            bomItems={bomItems}
            setBomItems={setBomItems}
            bomForm={bomForm}
            setBomForm={setBomForm}
            run={run}
            api={api}
            refreshBasics={refreshBasics}
          />
        )}

        {activeTab === "manufacturing" && (
          <ManufacturingTab
            t={t}
            products={products}
            form={manufacturingForm}
            setForm={setManufacturingForm}
            records={manufacturingRecords}
            run={run}
            api={api}
            refreshAll={async () => {
              await Promise.all([refreshManufacturing(), refreshBasics(), refreshShortages()]);
            }}
          />
        )}

        {activeTab === "sales" && (
          <SalesTab
            t={t}
            products={products}
            form={saleForm}
            setForm={setSaleForm}
            records={salesRecords}
            run={run}
            api={api}
            refreshAll={async () => {
              await Promise.all([refreshSales(), refreshBasics()]);
            }}
          />
        )}

        {activeTab === "damaged" && (
          <DamagedTab
            t={t}
            components={components}
            form={damageForm}
            setForm={setDamageForm}
            records={damageRecords}
            run={run}
            api={api}
            refreshAll={async () => {
              await Promise.all([refreshDamaged(), refreshBasics(), refreshShortages()]);
            }}
          />
        )}

        {activeTab === "maintenance" && (
          <MaintenanceTab
            t={t}
            components={components}
            tickets={maintenanceTickets}
            run={run}
            api={api}
            refreshAll={async () => {
              await Promise.all([refreshMaintenance(), refreshBasics(), refreshShortages()]);
            }}
          />
        )}

        {activeTab === "shortage" && (
          <section>
            <h2>{t("shortage")}</h2>
            <p>{t("lowStockNotice")}</p>
            <div className="filterBar">
              <select value={shortageSupplierId} onChange={(e) => setShortageSupplierId(e.target.value)}>
                <option value="">{t("allSuppliers")}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
              <button onClick={() => run(async () => refreshShortages())}>{t("refresh")}</button>
            </div>
            <DataTable
              columns={[t("itemName"), t("inventoryStock"), t("minimumStock"), t("supplier"), t("purchaseLink")]}
              rows={shortages.filter((row) => !shortageSupplierId || String(row.supplier_id) === shortageSupplierId)}
              emptyText={t("noData")}
              renderRow={(s) => (
                <>
                  <td>{s.item_name}</td>
                  <td>{s.stock_qty}</td>
                  <td>{s.effective_minimum_stock_qty}</td>
                  <td>{s.supplier_name || "-"}</td>
                  <td>{s.purchase_link ? <PurchaseLink href={s.purchase_link} label={t("openPurchaseLink")} /> : "-"}</td>
                </>
              )}
            />
          </section>
        )}

        {activeTab === "inventory" && (
          <section>
            <SectionHeader title={t("components")} />
            <div className="subTabs">
              <button type="button" onClick={() => setActiveTab("components")}>{t("components")}</button>
              <button type="button" className="active">{t("inventory")}</button>
            </div>
            <div className="gridForm">
              <input
                placeholder={t("inventorySearchPlaceholder")}
                value={inventoryQuery}
                onChange={(e) => {
                  setInventoryQuery(e.target.value);
                  setInventoryItem(null);
                }}
              />
            </div>
            <DataTable
              columns={[t("name"), t("type"), t("actions")]}
              rows={inventoryMatches}
              emptyText={t("noData")}
              renderRow={(m) => (
                <>
                  <td>{m.name}</td>
                  <td>{m.type === "component" ? t("components") : t("product")}</td>
                  <td>
                    <button
                      onClick={() =>
                        run(async () => {
                          const row = await api.get(
                            `/inventory/item${buildQuery({ type: m.type, id: m.id })}`
                          );
                          setInventoryItem(row);
                          setInventoryMatches([]);
                          setInventoryQuery(m.name);
                        })
                      }
                    >
                      {t("view")}
                    </button>
                  </td>
                </>
              )}
            />

            {inventoryItem && (
              <Modal title={inventoryItem.name} onClose={() => setInventoryItem(null)}>
              {inventoryItem.type === "component" ? (
                <DataTable
                  columns={[t("stockQty"), t("receivedAt"), t("supplier")]}
                  rows={[inventoryItem]}
                  emptyText={t("noData")}
                  renderRow={(row) => (
                    <>
                      <td>{row.stock_qty}</td>
                      <td>{row.last_purchased_at ? new Date(row.last_purchased_at).toLocaleString() : "-"}</td>
                      <td>{row.supplier_name || "-"}</td>
                    </>
                  )}
                />
              ) : (
                <DataTable
                  columns={[t("finishedStock"), t("producedAt")]}
                  rows={[inventoryItem]}
                  emptyText={t("noData")}
                  renderRow={(row) => (
                    <>
                      <td>{row.stock_qty}</td>
                      <td>{row.last_manufactured_at ? new Date(row.last_manufactured_at).toLocaleString() : "-"}</td>
                    </>
                  )}
                />
              )}
              </Modal>
            )}
          </section>
        )}

        {activeTab === "reports" && (
          <ReportsTab
            t={t}
            reportParams={reportParams}
            setReportParams={setReportParams}
            reportData={reportData}
            setReportData={setReportData}
            reportQuery={reportQuery}
            run={run}
          />
        )}

        {activeTab === "settings" && (
          <section>
            <h2>{t("settings")}</h2>
            <div className="gridForm">
              <button
                onClick={() =>
                  run(async () => {
                    await api.put("/settings/language", { language: "en" });
                    setLanguage("en");
                    setInfo(t("languageSaved"));
                  })
                }
              >
                {t("english")}
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await api.put("/settings/language", { language: "ar" });
                    setLanguage("ar");
                    setInfo(t("languageSaved"));
                  })
                }
              >
                {t("arabic")}
              </button>
              <button onClick={() => clearForms()}>{t("cancel")}</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function PurchasesTab({ t, suppliers, components, run, api, refreshAll }) {
  const [form, setForm] = useState(blankIntake());
  const [showForm, setShowForm] = useState(false);
  const normalizedName = form.name.trim().toLowerCase();
  const suggestions = components
    .filter((component) => component.item_name.toLowerCase().includes(normalizedName))
    .slice(0, 20);

  return (
    <section>
      <SectionHeader
        title={t("purchases")}
        actionLabel={`＋ ${t("newPurchase")}`}
        onAction={() => {
          setForm(blankIntake());
          setShowForm(true);
        }}
      />
      <div className="emptyStateHint">{t("purchaseHint")}</div>
      {showForm && (
        <Modal title={t("newPurchase")} onClose={() => setShowForm(false)}>
          <form
            className="gridForm"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const exactMatch = components.find(
                  (component) => component.item_name.trim().toLowerCase() === normalizedName
                );
                await api.post("/components/intake", {
                  name: form.name,
                  qty: Number(form.qty),
                  decision: exactMatch ? "existing" : "new",
                  existing_component_id: exactMatch?.id,
                  supplier_id: form.supplier_id || undefined,
                  purchase_link: form.purchase_link || undefined,
                  price_egp: form.price_egp === "" ? undefined : Number(form.price_egp),
                  minimum_stock_qty:
                    form.minimum_stock_qty === "" ? undefined : Number(form.minimum_stock_qty),
                  received_at: form.received_at || undefined,
                });
                setForm(blankIntake());
                setShowForm(false);
                await refreshAll();
              });
            }}
          >
            <input
              list="purchase-component-suggestions"
              placeholder={t("itemName")}
              value={form.name}
              onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
              required
            />
            <datalist id="purchase-component-suggestions">
              {suggestions.map((component) => (
                <option key={component.id} value={component.item_name} />
              ))}
            </datalist>
            <input
              type="number"
              min="1"
              placeholder={t("quantity")}
              value={form.qty}
              onChange={(event) => setForm((state) => ({ ...state, qty: event.target.value }))}
              required
            />
            <select
              value={form.supplier_id}
              onChange={(event) => setForm((state) => ({ ...state, supplier_id: event.target.value }))}
            >
              <option value="">{t("supplier")}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t("priceEgp")}
              value={form.price_egp}
              onChange={(event) => setForm((state) => ({ ...state, price_egp: event.target.value }))}
            />
            <input
              type="datetime-local"
              value={form.received_at}
              onChange={(event) => setForm((state) => ({ ...state, received_at: event.target.value }))}
              required
            />
            <input
              placeholder={t("purchaseLink")}
              value={form.purchase_link}
              onChange={(event) => setForm((state) => ({ ...state, purchase_link: event.target.value }))}
            />
            <button type="submit" className="primaryButton">{t("save")}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function ProductsBomTab({
  t,
  products,
  components,
  selectedProductId,
  setSelectedProductId,
  productForm,
  setProductForm,
  bomItems,
  setBomItems,
  bomForm,
  setBomForm,
  run,
  api,
  refreshBasics,
}) {
  const [showProductForm, setShowProductForm] = useState(false);
  const [showBomForm, setShowBomForm] = useState(false);
  const bomTotal = bomItems.reduce(
    (total, item) => total + Number(item.qty_per_unit) * Number(item.latest_price_egp || 0),
    0
  );

  return (
    <section>
      <SectionHeader
        title={t("productsBom")}
        actionLabel={`＋ ${t("create")}`}
        onAction={() => {
          setProductForm(blankProduct());
          setShowProductForm(true);
        }}
      />
      {(showProductForm || productForm.id) && (
      <Modal
        title={`${productForm.id ? t("edit") : t("create")} ${t("product")}`}
        onClose={() => {
          setProductForm(blankProduct());
          setShowProductForm(false);
        }}
      >
      <form
        className="gridForm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (productForm.id) {
              await api.put(`/products/${productForm.id}`, { name: productForm.name });
            } else {
              await api.post("/products", { name: productForm.name });
            }
            setProductForm(blankProduct());
            setShowProductForm(false);
            await refreshBasics();
          });
        }}
      >
        <input
          placeholder={t("name")}
          value={productForm.name}
          onChange={(e) => setProductForm((s) => ({ ...s, name: e.target.value }))}
        />
        <button type="submit">{productForm.id ? t("update") : t("create")}</button>
      </form>
      </Modal>
      )}

      <DataTable
        columns={[t("name"), t("finishedStock"), t("actions")]}
        rows={products}
        emptyText={t("noData")}
        renderRow={(p) => (
          <>
            <td>{p.name}</td>
            <td>{p.finished_stock_qty}</td>
            <td>
              <button onClick={() => setSelectedProductId(String(p.id))}>{t("bomItems")}</button>
              <button onClick={() => setProductForm(p)}>{t("edit")}</button>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await api.delete(`/products/${p.id}`);
                    if (String(p.id) === selectedProductId) {
                      setSelectedProductId("");
                      setBomItems([]);
                    }
                    await refreshBasics();
                  })
                }
              >
                {t("delete")}
              </button>
            </td>
          </>
        )}
      />

      <SectionHeader
        title={t("bomItems")}
        actionLabel={`＋ ${t("save")}`}
        onAction={() => setShowBomForm(true)}
        compact
      />
      {showBomForm && (
      <Modal title={t("bomItems")} onClose={() => setShowBomForm(false)}>
      <form
        className="gridForm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!selectedProductId) throw new Error("Select a product first");
            await api.post(`/products/${selectedProductId}/bom`, {
              component_id: Number(bomForm.component_id),
              qty_per_unit: Number(bomForm.qty_per_unit),
            });
            const rows = await api.get(`/products/${selectedProductId}/bom`);
            setBomItems(rows);
            setBomForm({ component_id: "", qty_per_unit: 1 });
            setShowBomForm(false);
          });
        }}
      >
        <select
          value={bomForm.component_id}
          onChange={(e) => setBomForm((s) => ({ ...s, component_id: e.target.value }))}
        >
          <option value="">{t("components")}</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.item_name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={bomForm.qty_per_unit}
          onChange={(e) => setBomForm((s) => ({ ...s, qty_per_unit: e.target.value }))}
        />
        <button type="submit">{t("save")}</button>
      </form>
      </Modal>
      )}

      <DataTable
        columns={[t("itemName"), t("qtyPerUnit"), t("unitPrice"), t("lineTotal"), t("actions")]}
        rows={bomItems}
        emptyText={t("noData")}
        renderRow={(b) => (
          <>
            <td>{b.item_name}</td>
            <td>{b.qty_per_unit}</td>
            <td>{b.latest_price_egp == null ? "-" : Number(b.latest_price_egp).toFixed(2)}</td>
            <td>
              {b.latest_price_egp == null
                ? "-"
                : (Number(b.qty_per_unit) * Number(b.latest_price_egp)).toFixed(2)}
            </td>
            <td>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await api.delete(`/products/${selectedProductId}/bom/${b.id}`);
                    const rows = await api.get(`/products/${selectedProductId}/bom`);
                    setBomItems(rows);
                  })
                }
              >
                {t("delete")}
              </button>
            </td>
          </>
        )}
      />
      {bomItems.length > 0 && (
        <div className="bomTotal">
          <strong>{t("bomTotal")}:</strong>{" "}
          <span>{`${bomTotal.toFixed(2)} EGP`}</span>
        </div>
      )}
    </section>
  );
}

function ManufacturingTab({ t, products, form, setForm, records, run, api, refreshAll }) {
  const [activeStage, setActiveStage] = useState("order");
  const [showForm, setShowForm] = useState(false);
  const stageRecords = records.filter((record) => (record.status || "completed") === activeStage);

  const moveRecord = (record, status) =>
    run(async () => {
      await api.put(`/manufacturing-records/${record.id}`, { status });
      await refreshAll();
      setActiveStage(status);
    });

  return (
    <section>
      <SectionHeader
        title={t("manufacturing")}
        actionLabel={activeStage === "order" ? `＋ ${t("manufacturingOrder")}` : null}
        onAction={() => {
          setForm(blankManufacturing());
          setShowForm(true);
        }}
      />
      <div className="subTabs">
        {[
          ["order", t("manufacturingOrder")],
          ["in_progress", t("inManufacturing")],
          ["completed", t("manufacturingCompleted")],
        ].map(([status, label]) => (
          <button
            key={status}
            type="button"
            className={activeStage === status ? "active" : ""}
            onClick={() => {
              setActiveStage(status);
              setForm(blankManufacturing());
              setShowForm(false);
            }}
          >
            {label} ({records.filter((record) => (record.status || "completed") === status).length})
          </button>
        ))}
      </div>

      {activeStage === "order" && (showForm || form.id) && <Modal
        title={`${form.id ? t("edit") : t("create")} ${t("manufacturingOrder")}`}
        onClose={() => {
          setForm(blankManufacturing());
          setShowForm(false);
        }}
      ><form
        className="gridForm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const payload = {
              product_id: Number(form.product_id),
              units_produced: Number(form.units_produced),
              produced_at: form.produced_at || undefined,
            };
            if (form.id) {
              await api.put(`/manufacturing-records/${form.id}`, payload);
            } else {
              await api.post("/manufacturing-records", payload);
            }
            setForm(blankManufacturing());
            setShowForm(false);
            await refreshAll();
          });
        }}
      >
        <select value={form.product_id} onChange={(e) => setForm((s) => ({ ...s, product_id: e.target.value }))}>
          <option value="">{t("product")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={form.units_produced}
          onChange={(e) => setForm((s) => ({ ...s, units_produced: e.target.value }))}
        />
        <input
          type="datetime-local"
          value={form.produced_at}
          onChange={(e) => setForm((s) => ({ ...s, produced_at: e.target.value }))}
        />
        <button type="submit">{form.id ? t("update") : t("create")}</button>
      </form></Modal>}
      <DataTable
        columns={[t("product"), t("unitsProduced"), t("producedAt"), t("actions")]}
        rows={stageRecords}
        emptyText={t("noData")}
        renderRow={(r) => (
          <>
            <td>{r.product_name}</td>
            <td>{r.units_produced}</td>
            <td>{new Date(r.produced_at).toLocaleString()}</td>
            <td>
              {activeStage === "order" && <button
                onClick={() =>
                  setForm({
                    id: r.id,
                    product_id: String(r.product_id),
                    units_produced: r.units_produced,
                    produced_at: toLocalDateTimeValue(r.produced_at),
                  })
                }
              >
                {t("edit")}
              </button>}
              {activeStage === "order" && (
                <button onClick={() => moveRecord(r, "in_progress")}>{t("startManufacturing")}</button>
              )}
              {activeStage === "in_progress" && (
                <button onClick={() => moveRecord(r, "completed")}>{t("completeManufacturing")}</button>
              )}
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await api.delete(`/manufacturing-records/${r.id}`);
                    await refreshAll();
                  })
                }
              >
                {t("delete")}
              </button>
            </td>
          </>
        )}
      />
    </section>
  );
}

function SalesTab({ t, products, form, setForm, records, run, api, refreshAll }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section className="salesSection">
      <SectionHeader
        title={t("sales")}
        actionLabel={`＋ ${t("create")}`}
        onAction={() => {
          setForm(blankSale());
          setShowForm(true);
        }}
      />
      {(showForm || form.id) && <Modal
        title={`${form.id ? t("edit") : t("create")} ${t("sales")}`}
        onClose={() => {
          setForm(blankSale());
          setShowForm(false);
        }}
      >
      <form
        className="gridForm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const payload = {
              product_id: Number(form.product_id),
              units_sold: Number(form.units_sold),
              unit_sell_price_egp: Number(form.unit_sell_price_egp),
              manufacturing_cost_per_unit: Number(form.manufacturing_cost_per_unit),
              sold_at: form.sold_at || undefined,
            };
            if (form.id) {
              await api.put(`/sales-records/${form.id}`, payload);
            } else {
              await api.post("/sales-records", payload);
            }
            setForm(blankSale());
            setShowForm(false);
            await refreshAll();
          });
        }}
      >
        <select value={form.product_id} onChange={(e) => setForm((s) => ({ ...s, product_id: e.target.value }))}>
          <option value="">{t("product")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={form.units_sold}
          onChange={(e) => setForm((s) => ({ ...s, units_sold: e.target.value }))}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.unit_sell_price_egp}
          onChange={(e) => setForm((s) => ({ ...s, unit_sell_price_egp: e.target.value }))}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder={t("manufacturingCostPerUnit")}
          value={form.manufacturing_cost_per_unit}
          onChange={(e) => setForm((s) => ({ ...s, manufacturing_cost_per_unit: e.target.value }))}
        />
        <input
          type="datetime-local"
          value={form.sold_at}
          onChange={(e) => setForm((s) => ({ ...s, sold_at: e.target.value }))}
        />
        <button type="submit">{form.id ? t("update") : t("create")}</button>
      </form>
      </Modal>}
      <DataTable
        columns={[
          t("product"),
          t("unitsSold"),
          t("unitSellPrice"),
          t("manufacturingCostPerUnit"),
          t("purchaseCost"),
          t("revenue"),
          t("grossProfit"),
          t("margin"),
          t("manufacturingPaid"),
          t("actions"),
        ]}
        rows={records}
        emptyText={t("noData")}
        renderRow={(r) => (
          <>
            <td>{r.product_name}</td>
            <td>{r.units_sold}</td>
            <td>{r.unit_sell_price_egp}</td>
            <td>{r.manufacturing_cost_per_unit ?? 1000}</td>
            <td>{r.total_purchase_cost_egp}</td>
            <td>{r.revenue_egp}</td>
            <td>{r.gross_profit_egp}</td>
            <td>{r.margin_pct}</td>
            <td>
              <input
                type="checkbox"
                className="accountedCheckbox"
                checked={Boolean(r.is_accounted)}
                aria-label={t("manufacturingPaid")}
                onChange={(event) =>
                  run(async () => {
                    await api.put(`/sales-records/${r.id}`, { is_accounted: event.target.checked });
                    await refreshAll();
                  })
                }
              />
            </td>
            <td>
              <button
                onClick={() =>
                  setForm({
                    id: r.id,
                    product_id: String(r.product_id),
                    units_sold: r.units_sold,
                    unit_sell_price_egp: r.unit_sell_price_egp,
                    manufacturing_cost_per_unit: r.manufacturing_cost_per_unit ?? 1000,
                    sold_at: toLocalDateTimeValue(r.sold_at),
                  })
                }
              >
                {t("edit")}
              </button>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await api.delete(`/sales-records/${r.id}`);
                    await refreshAll();
                  })
                }
              >
                {t("delete")}
              </button>
            </td>
          </>
        )}
      />
    </section>
  );
}

function escapeInvoiceText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printMaintenanceInvoice(ticket, t) {
  const invoiceWindow = window.open("", "_blank");
  if (!invoiceWindow) return;
  invoiceWindow.opener = null;
  const logoUrl = new URL("diamond-logo.svg", window.location.href).href;
  const completedDate = ticket.completed_at || ticket.opened_at;
  invoiceWindow.document.write(`<!doctype html>
  <html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>maintenance-invoice-${ticket.id}</title>
  <style>
    @page { size: A5 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172126; font-family: Tahoma, Arial, sans-serif; background: #fff; }
    .invoice { min-height: 190mm; border: 1px solid #d6e1e5; border-radius: 12px; overflow: hidden; }
    .head { padding: 12mm 10mm 7mm; text-align: center; background: linear-gradient(135deg,#f3fbfc,#fff); border-bottom: 3px solid #1596bb; }
    .logo { width: 100%; max-height: 34mm; object-fit: contain; }
    h1 { margin: 6mm 0 1mm; font-size: 20px; color: #116f91; }
    .meta { color: #65737b; font-size: 11px; }
    .body { padding: 8mm 10mm; }
    .row { display: grid; grid-template-columns: 34mm 1fr; gap: 5mm; padding: 4mm 0; border-bottom: 1px solid #e6edef; }
    .label { color: #617078; font-weight: 700; }
    .value { font-weight: 600; white-space: pre-wrap; }
    .total { margin-top: 8mm; padding: 6mm; border-radius: 10px; background: #e9f8fa; color: #075f78; text-align: center; font-size: 20px; font-weight: 800; }
    .footer { padding: 7mm 10mm; text-align: center; color: #76848b; font-size: 10px; }
  </style></head><body><article class="invoice">
    <header class="head"><img class="logo" src="${logoUrl}" alt="Diamond for Printer Solutions"><h1>${escapeInvoiceText(t("maintenanceInvoice"))}</h1><div class="meta">#${ticket.id} — ${escapeInvoiceText(new Date(completedDate).toLocaleDateString("ar-EG"))}</div></header>
    <main class="body">
      <div class="row"><div class="label">${escapeInvoiceText(t("customerName"))}</div><div class="value">${escapeInvoiceText(ticket.customer_name)}</div></div>
      <div class="row"><div class="label">${escapeInvoiceText(t("phone"))}</div><div class="value">${escapeInvoiceText(ticket.phone)}</div></div>
      <div class="row"><div class="label">${escapeInvoiceText(t("deviceIssue"))}</div><div class="value">${escapeInvoiceText(ticket.device_issue)}</div></div>
      <div class="row"><div class="label">${escapeInvoiceText(t("maintenanceDescription"))}</div><div class="value">${escapeInvoiceText(ticket.maintenance_description || "-")}</div></div>
      <div class="total">${escapeInvoiceText(t("repairCharge"))}: ${escapeInvoiceText(ticket.repair_charge_egp)} EGP</div>
    </main>
    <footer class="footer">DIAMOND FOR PRINTER SOLUTIONS</footer>
  </article><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));<\/script></body></html>`);
  invoiceWindow.document.close();
}

function MaintenanceTab({ t, components, tickets, run, api, refreshAll }) {
  const [activeStage, setActiveStage] = useState("request");
  const [showRequest, setShowRequest] = useState(false);
  const [requestForm, setRequestForm] = useState(blankMaintenanceTicket());
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [editingTicket, setEditingTicket] = useState(null);
  const [partForm, setPartForm] = useState({ component_id: "", qty_used: 1 });
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) || null;
  const visibleTickets = tickets.filter((ticket) =>
    activeStage === "completed" ? ticket.status === "completed" : ticket.status === "in_progress"
  );

  return (
    <section>
      <SectionHeader title={t("maintenance")} />
      <div className="subTabs">
        <button
          type="button"
          className={activeStage === "request" ? "active" : ""}
          onClick={() => {
            setActiveStage("request");
            setRequestForm(blankMaintenanceTicket());
            setShowRequest(true);
          }}
        >
          {t("maintenanceRequest")}
        </button>
        <button
          type="button"
          className={activeStage === "in_progress" ? "active" : ""}
          onClick={() => setActiveStage("in_progress")}
        >
          {t("underMaintenance")} ({tickets.filter((ticket) => ticket.status === "in_progress").length})
        </button>
        <button
          type="button"
          className={activeStage === "completed" ? "active" : ""}
          onClick={() => setActiveStage("completed")}
        >
          {t("maintenanceCompleted")} ({tickets.filter((ticket) => ticket.status === "completed").length})
        </button>
      </div>

      {activeStage === "request" && (
        <div className="emptyStateHint">
          <button type="button" className="primaryButton" onClick={() => setShowRequest(true)}>
            ＋ {t("openMaintenanceTicket")}
          </button>
        </div>
      )}

      {activeStage !== "request" && (
        <DataTable
          columns={[t("customerName"), t("phone"), t("deviceIssue"), t("repairCharge"), t("partsCost"), t("actions")]}
          rows={visibleTickets}
          emptyText={t("noData")}
          renderRow={(ticket) => (
            <>
              <td>{ticket.customer_name}</td>
              <td>{ticket.phone}</td>
              <td>{ticket.device_issue}</td>
              <td>{ticket.repair_charge_egp} EGP</td>
              <td>{ticket.parts_cost_egp}</td>
              <td>
                <button type="button" onClick={() => setSelectedTicketId(ticket.id)}>{t("view")}</button>
                <button type="button" onClick={() => setEditingTicket({ ...ticket })}>{t("edit")}</button>
                <button type="button" className="pdfButton" title={t("downloadInvoice")} onClick={() => printMaintenanceInvoice(ticket, t)}>📄 PDF</button>
                <button type="button" className="danger" onClick={() => {
                  if (!window.confirm(t("confirmDeleteTicket"))) return;
                  run(async () => {
                    await api.delete(`/maintenance-tickets/${ticket.id}`);
                    await refreshAll();
                  });
                }}>{t("delete")}</button>
                {ticket.status === "completed" && (
                  <label className="checkboxLabel">
                    <input
                      type="checkbox"
                      className="accountedCheckbox"
                      checked={Boolean(ticket.delivered)}
                      onChange={(event) => run(async () => {
                        await api.put(`/maintenance-tickets/${ticket.id}`, { delivered: event.target.checked });
                        await refreshAll();
                      })}
                    />
                    {t("delivered")}
                  </label>
                )}
              </td>
            </>
          )}
        />
      )}

      {showRequest && (
        <Modal title={t("openMaintenanceTicket")} onClose={() => setShowRequest(false)}>
          <form className="gridForm" onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await api.post("/maintenance-tickets", requestForm);
              setRequestForm(blankMaintenanceTicket());
              setShowRequest(false);
              setActiveStage("in_progress");
              await refreshAll();
            });
          }}>
            <input placeholder={t("customerName")} value={requestForm.customer_name} onChange={(event) => setRequestForm((state) => ({ ...state, customer_name: event.target.value }))} required />
            <input placeholder={t("phone")} value={requestForm.phone} onChange={(event) => setRequestForm((state) => ({ ...state, phone: event.target.value }))} required />
            <textarea placeholder={t("deviceIssue")} value={requestForm.device_issue} onChange={(event) => setRequestForm((state) => ({ ...state, device_issue: event.target.value }))} required />
            <input type="datetime-local" value={requestForm.opened_at} onChange={(event) => setRequestForm((state) => ({ ...state, opened_at: event.target.value }))} />
            <button type="submit" className="primaryButton">{t("save")}</button>
          </form>
        </Modal>
      )}

      {editingTicket && (
        <Modal title={`${t("edit")} ${t("maintenanceTicket")} #${editingTicket.id}`} onClose={() => setEditingTicket(null)}>
          <form className="gridForm" onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await api.put(`/maintenance-tickets/${editingTicket.id}`, {
                customer_name: editingTicket.customer_name,
                phone: editingTicket.phone,
                device_issue: editingTicket.device_issue,
                maintenance_description: editingTicket.maintenance_description,
                repair_charge_egp: Number(editingTicket.repair_charge_egp || 0),
              });
              setEditingTicket(null);
              await refreshAll();
            });
          }}>
            <input placeholder={t("customerName")} value={editingTicket.customer_name} onChange={(event) => setEditingTicket((state) => ({ ...state, customer_name: event.target.value }))} required />
            <input placeholder={t("phone")} value={editingTicket.phone} onChange={(event) => setEditingTicket((state) => ({ ...state, phone: event.target.value }))} required />
            <textarea placeholder={t("deviceIssue")} value={editingTicket.device_issue} onChange={(event) => setEditingTicket((state) => ({ ...state, device_issue: event.target.value }))} required />
            <textarea placeholder={t("maintenanceDescription")} value={editingTicket.maintenance_description || ""} onChange={(event) => setEditingTicket((state) => ({ ...state, maintenance_description: event.target.value }))} />
            <input type="number" min="0" step="0.01" placeholder={t("repairCharge")} value={editingTicket.repair_charge_egp} onChange={(event) => setEditingTicket((state) => ({ ...state, repair_charge_egp: event.target.value }))} />
            <button type="submit" className="primaryButton">{t("update")}</button>
          </form>
        </Modal>
      )}

      {selectedTicket && (
        <Modal title={`${t("maintenanceTicket")} #${selectedTicket.id}`} onClose={() => setSelectedTicketId(null)} wide>
          <div className="ticketDetails">
            <div><span>{t("customerName")}</span><strong>{selectedTicket.customer_name}</strong></div>
            <div><span>{t("phone")}</span><strong>{selectedTicket.phone}</strong></div>
            <div className="ticketIssue"><span>{t("deviceIssue")}</span><strong>{selectedTicket.device_issue}</strong></div>
          </div>
          <DataTable
            columns={[t("itemName"), t("quantity"), t("unitPrice"), t("lineTotal"), t("actions")]}
            rows={selectedTicket.parts}
            emptyText={t("noData")}
            renderRow={(part) => (
              <>
                <td>{part.item_name}</td><td>{part.qty_used}</td><td>{part.unit_price_egp}</td><td>{part.total_price_egp}</td>
                <td>{selectedTicket.status === "in_progress" && <button className="danger" onClick={() => run(async () => {
                  await api.delete(`/maintenance-parts/${part.id}`);
                  await refreshAll();
                })}>{t("delete")}</button>}</td>
              </>
            )}
          />
          {selectedTicket.status === "in_progress" && (
            <form className="gridForm modalSection" onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await api.post(`/maintenance-tickets/${selectedTicket.id}/parts`, {
                  component_id: Number(partForm.component_id),
                  qty_used: Number(partForm.qty_used),
                });
                setPartForm({ component_id: "", qty_used: 1 });
                await refreshAll();
              });
            }}>
              <select value={partForm.component_id} onChange={(event) => setPartForm((state) => ({ ...state, component_id: event.target.value }))} required>
                <option value="">{t("components")}</option>
                {components.map((component) => <option key={component.id} value={component.id}>{component.item_name} ({component.stock_qty})</option>)}
              </select>
              <input type="number" min="1" value={partForm.qty_used} onChange={(event) => setPartForm((state) => ({ ...state, qty_used: event.target.value }))} required />
              <button type="submit">{t("addPart")}</button>
            </form>
          )}
          <div className="ticketTotals">
            <span>{t("partsCost")}: <strong>{selectedTicket.parts_cost_egp} EGP</strong></span>
            <span>{t("repairCharge")}: <strong>{selectedTicket.repair_charge_egp} EGP</strong></span>
          </div>
          {selectedTicket.status === "completed" && (
            <div className="maintenanceDescriptionBox">
              <span>{t("maintenanceDescription")}</span>
              <p>{selectedTicket.maintenance_description || "-"}</p>
            </div>
          )}
          {selectedTicket.status === "in_progress" && (
            <form className="gridForm modalSection" onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.repair_charge_egp;
              const description = event.currentTarget.elements.maintenance_description;
              run(async () => {
                await api.put(`/maintenance-tickets/${selectedTicket.id}`, {
                  repair_charge_egp: Number(input.value),
                  maintenance_description: description.value,
                  status: "completed",
                });
                setSelectedTicketId(null);
                setActiveStage("completed");
                await refreshAll();
              });
            }}>
              <textarea name="maintenance_description" defaultValue={selectedTicket.maintenance_description || ""} placeholder={t("maintenanceDescription")} required />
              <input name="repair_charge_egp" type="number" min="0" step="0.01" defaultValue={selectedTicket.repair_charge_egp || ""} placeholder={t("repairCharge")} required />
              <button type="submit" className="primaryButton">{t("completeMaintenance")}</button>
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}

function DamagedTab({ t, components, form, setForm, records, run, api, refreshAll }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section>
      <SectionHeader
        title={t("damaged")}
        actionLabel={`＋ ${t("create")}`}
        onAction={() => {
          setForm(blankDamage());
          setShowForm(true);
        }}
      />
      {(showForm || form.id) && <Modal
        title={`${form.id ? t("edit") : t("create")} ${t("damaged")}`}
        onClose={() => {
          setForm(blankDamage());
          setShowForm(false);
        }}
      >
      <form
        className="gridForm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const payload = {
              component_id: Number(form.component_id),
              qty_damaged: Number(form.qty_damaged),
              damaged_at: form.damaged_at || undefined,
            };
            if (form.id) {
              await api.put(`/damage-records/${form.id}`, payload);
            } else {
              await api.post("/damage-records", payload);
            }
            setForm(blankDamage());
            setShowForm(false);
            await refreshAll();
          });
        }}
      >
        <select
          value={form.component_id}
          onChange={(e) => setForm((s) => ({ ...s, component_id: e.target.value }))}
        >
          <option value="">{t("components")}</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.item_name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={form.qty_damaged}
          onChange={(e) => setForm((s) => ({ ...s, qty_damaged: e.target.value }))}
        />
        <input
          type="datetime-local"
          value={form.damaged_at}
          onChange={(e) => setForm((s) => ({ ...s, damaged_at: e.target.value }))}
        />
        <button type="submit">{form.id ? t("update") : t("create")}</button>
      </form>
      </Modal>}
      <DataTable
        columns={[t("itemName"), t("qtyDamaged"), t("damagedAt"), t("actions")]}
        rows={records}
        emptyText={t("noData")}
        renderRow={(r) => (
          <>
            <td>{r.item_name}</td>
            <td>{r.qty_damaged}</td>
            <td>{new Date(r.damaged_at).toLocaleString()}</td>
            <td>
              <button
                onClick={() =>
                  setForm({
                    id: r.id,
                    component_id: String(r.component_id),
                    qty_damaged: r.qty_damaged,
                    damaged_at: toLocalDateTimeValue(r.damaged_at),
                  })
                }
              >
                {t("edit")}
              </button>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await api.delete(`/damage-records/${r.id}`);
                    await refreshAll();
                  })
                }
              >
                {t("delete")}
              </button>
            </td>
          </>
        )}
      />
    </section>
  );
}

function ReportsTab({ t, reportParams, setReportParams, reportData, setReportData, reportQuery, run }) {
  async function exportCsv() {
    const csv = await api.get(`/reports/sales.csv${reportQuery}`);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = `sales-report-${reportParams.period}.csv`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>{t("reports")}</h2>
      <div className="gridForm">
        <select
          value={reportParams.period}
          onChange={(e) => setReportParams((s) => ({ ...s, period: e.target.value }))}
        >
          <option value="daily">{t("daily")}</option>
          <option value="weekly">{t("weekly")}</option>
          <option value="monthly">{t("monthly")}</option>
          <option value="yearly">{t("yearly")}</option>
          <option value="specific_day">{t("specificDay")}</option>
          <option value="date_range">{t("dateRange")}</option>
        </select>
        {(reportParams.period === "daily" ||
          reportParams.period === "weekly" ||
          reportParams.period === "monthly" ||
          reportParams.period === "yearly" ||
          reportParams.period === "specific_day") && (
          <input
            type="date"
            value={reportParams.date}
            onChange={(e) => setReportParams((s) => ({ ...s, date: e.target.value }))}
          />
        )}
        {reportParams.period === "date_range" && (
          <>
            <input
              type="date"
              value={reportParams.start_date}
              onChange={(e) => setReportParams((s) => ({ ...s, start_date: e.target.value }))}
            />
            <input
              type="date"
              value={reportParams.end_date}
              onChange={(e) => setReportParams((s) => ({ ...s, end_date: e.target.value }))}
            />
          </>
        )}
        <button
          onClick={() =>
            run(async () => {
              const data = await api.get(`/reports/sales${reportQuery}`);
              setReportData(data);
            })
          }
        >
          {t("refresh")}
        </button>
        <button
          onClick={() =>
            run(async () => {
              await exportCsv();
            })
          }
        >
          {t("exportCsv")}
        </button>
      </div>

      {reportData && (
        <>
          <h3>{t("reportSummary")}</h3>
          <div className="metrics">
            <Metric label={t("revenue")} value={reportData.summary.revenue_egp} />
            <Metric label={t("purchaseCost")} value={reportData.summary.purchase_cost_egp} />
            <Metric label={t("grossProfit")} value={reportData.summary.gross_profit_egp} />
            <Metric label={t("unitsSold")} value={reportData.summary.units_sold} />
            <Metric label={t("manufacturingCostTotal")} value={reportData.summary.manufacturing_cost_egp} />
            <Metric label={t("manufacturingPaidUnits")} value={reportData.summary.manufacturing_paid_units} />
            <Metric label={t("manufacturingRemainingUnits")} value={reportData.summary.manufacturing_remaining_units} />
            <Metric label={t("maintenanceRevenue")} value={reportData.summary.maintenance_revenue_egp} />
            <Metric label={t("maintenancePartsCost")} value={reportData.summary.maintenance_parts_cost_egp} />
            <Metric label={t("maintenanceProfit")} value={reportData.summary.maintenance_profit_egp} />
            <Metric label={t("totalProfitWithMaintenance")} value={reportData.summary.total_profit_with_maintenance_egp} />
            <Metric label={t("deliveredMaintenanceCount")} value={reportData.summary.delivered_maintenance_count} />
            <Metric label={t("margin")} value={reportData.summary.avg_margin_pct} />
          </div>

          <h3>{t("reportBuckets")}</h3>
          <DataTable
            columns={[
              "Bucket",
              t("revenue"),
              t("purchaseCost"),
              t("grossProfit"),
              t("unitsSold"),
              t("margin"),
            ]}
            rows={reportData.buckets}
            emptyText={t("noData")}
            renderRow={(b) => (
              <>
                <td>{b.bucket}</td>
                <td>{b.revenue_egp}</td>
                <td>{b.purchase_cost_egp}</td>
                <td>{b.gross_profit_egp}</td>
                <td>{b.units_sold}</td>
                <td>{b.avg_margin_pct}</td>
              </>
            )}
          />

          {reportData.damaged && (
            <>
              <h3>{t("damagedReportSummary")}</h3>
              <div className="metrics">
                <Metric label={t("totalDamagedQty")} value={reportData.damaged.summary.damaged_qty} />
                <Metric label={t("damagedRecords")} value={reportData.damaged.summary.records_count} />
              </div>

              <h3>{t("damagedReportBuckets")}</h3>
              <DataTable
                columns={["Bucket", t("qtyDamaged"), t("damagedRecords")]}
                rows={reportData.damaged.buckets}
                emptyText={t("noData")}
                renderRow={(b) => (
                  <>
                    <td>{b.bucket}</td>
                    <td>{b.damaged_qty}</td>
                    <td>{b.records_count}</td>
                  </>
                )}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

function normalizePurchaseUrl(value) {
  const cleaned = String(value || "").trim().replace(/^\/+((?:https?:\/\/))/i, "$1");
  if (!cleaned) return "";
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return `https://${cleaned}`;
}

function SectionHeader({ title, actionLabel, onAction, compact = false }) {
  return (
    <div className={`sectionHeader${compact ? " sectionHeaderCompact" : ""}`}>
      {compact ? <h3>{title}</h3> : <h2>{title}</h2>}
      {actionLabel && onAction && (
        <button type="button" className="primaryButton" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Modal({ title, onClose, wide = false, children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div
        className={`modalCard${wide ? " modalCardWide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader">
          <h3>{title}</h3>
          <button type="button" className="modalClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}

function PurchaseLink({ href, label }) {
  return (
    <a
      href={normalizePurchaseUrl(href)}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="purchaseIcon"
    >
      🌐
    </a>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataTable({ columns, rows, renderRow, emptyText }) {
  return (
    <div className="tableScroll">
    <table className="dataTable">
      <thead>
        <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {!rows.length && (
          <tr>
            <td colSpan={columns.length}>{emptyText}</td>
          </tr>
        )}
        {rows.map((row, index) => (
          <tr key={row.id ?? `${index}`}>{renderRow(row)}</tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export default App;
