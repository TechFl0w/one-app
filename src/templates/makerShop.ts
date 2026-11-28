import type { Automation, Page, Table } from "@/schema/blueprint";
import { list, multi, type Question, type Template } from "./types";
import { automation, block, COLORS, date, email, finish, link, longText, money, num, optId, page, phone, status, text } from "./kit";

const products: Question & { kind: "list" } = {
  id: "products",
  kind: "list",
  label: "What do you make?",
  placeholder: "e.g. Glass bauble",
  hint: "A few products to start with.",
  max: 30,
  default: ["Glass bauble", "Wooden star"],
};
const channels: Question & { kind: "multi" } = {
  id: "channels",
  kind: "multi",
  label: "Where do orders come from?",
  options: [
    { id: "etsy", label: "Etsy" },
    { id: "instagram", label: "Instagram / DMs" },
    { id: "website", label: "Own website" },
    { id: "markets", label: "Markets & fairs" },
    { id: "wholesale", label: "Shops (wholesale)" },
  ],
  default: ["etsy", "instagram"],
};
const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it handle?",
  options: [
    { id: "stock", label: "Stock & low-stock alerts" },
    { id: "shipping", label: "Shipping & ship-by dates" },
    { id: "updates", label: "Order updates to customers", hint: "Message when an order ships" },
  ],
  default: ["stock", "shipping"],
};

const CHANNEL_LABELS: Record<string, string> = { etsy: "Etsy", instagram: "Instagram", website: "Website", markets: "Market", wholesale: "Wholesale" };

export const makerShop: Template = {
  id: "maker_shop",
  label: "Sell products",
  description: "Products and stock, orders from every channel, customers, shipping.",
  businessType: "maker_shop",
  questions: [products, channels, extras],
  build(business, answers) {
    const want = new Set(multi(answers, extras));
    const channelLabels = multi(answers, channels).map((c) => CHANNEL_LABELS[c]);
    const tables: Table[] = [
      {
        id: "tbl_products",
        label: "Products",
        primaryField: "fld_name",
        fields: [text("fld_name", "Product", true), money("fld_price", "Price"), ...(want.has("stock") ? [num("fld_stock", "In stock")] : [])],
      },
      { id: "tbl_customers", label: "Customers", primaryField: "fld_name", fields: [text("fld_name", "Name", true), email("fld_email"), phone("fld_phone"), longText("fld_address", "Address")] },
      {
        id: "tbl_orders",
        label: "Orders",
        primaryField: "fld_customer",
        fields: [
          link("fld_customer", "Customer", "tbl_customers", { required: true }),
          link("fld_products", "Products", "tbl_products", { multiple: true }),
          status("fld_status", "Status", [["New", COLORS.AMBER], ["Paid", COLORS.BLUE], ["Making", COLORS.BLUE], ["Shipped", COLORS.GREEN], ["Cancelled", COLORS.GREY]]),
          ...(channelLabels.length ? [status("fld_channel", "Channel", channelLabels.map((l) => [l] as [string]), "choice")] : []),
          money("fld_total", "Total"),
          date("fld_ordered", "Ordered"),
          ...(want.has("shipping") ? [date("fld_ship_by", "Ship by"), text("fld_tracking", "Tracking")] : []),
          longText("fld_notes", "Notes"),
        ],
      },
    ];

    const openOrders = [{ field: "fld_status", op: "neq" as const, value: optId("Shipped") }, { field: "fld_status", op: "neq" as const, value: optId("Cancelled") }];
    const pages: Page[] = [
      page("pg_today", "Today", "sun", 0, [
        block("blk_open", "number", [0, 0, 4, 1], { table: "tbl_orders", agg: "count", filters: openOrders }, { title: "Open orders" }),
        block("blk_new", "number", [4, 0, 4, 1], { table: "tbl_orders", agg: "count", filters: [{ field: "fld_status", op: "eq", value: optId("New") }] }, { title: "New orders" }),
        ...(want.has("stock")
          ? [block("blk_low", "number", [8, 0, 4, 1], { table: "tbl_products", agg: "count", filters: [{ field: "fld_stock", op: "lte", value: 3 }] }, { title: "Low on stock" })]
          : [block("blk_revenue", "number", [8, 0, 4, 1], { table: "tbl_orders", agg: "sum", field: "fld_total", filters: [{ field: "fld_ordered", op: "eq", value: "@this_month" }] }, { title: "Sold this month" })]),
        want.has("shipping")
          ? block("blk_ship", "list", [0, 1, 12, 5], { table: "tbl_orders", filters: openOrders, sort: [{ field: "fld_ship_by", dir: "asc" }] }, { title: "To ship next" })
          : block("blk_recent", "list", [0, 1, 12, 5], { table: "tbl_orders", filters: openOrders, sort: [{ field: "_created_at", dir: "desc" }] }, { title: "Open orders" }),
      ]),
      page("pg_orders", "Orders", "orders", 1, [
        block("blk_orders", "board", [0, 0, 12, 8], { table: "tbl_orders", groupBy: "fld_status" }, { title: "Orders" }),
      ]),
      page("pg_products", "Products", "products", 2, [block("blk_products", "table", [0, 0, 12, 6], { table: "tbl_products", sort: [{ field: "fld_name", dir: "asc" }] }, { title: "Products" })]),
      page("pg_customers", "Customers", "users", 3, [
        block("blk_customers", "table", [0, 0, 12, 6], { table: "tbl_customers", sort: [{ field: "fld_name", dir: "asc" }] }, { title: "Customers" }),
      ]),
    ];

    const automations: Automation[] = [];
    if (want.has("stock")) {
      automations.push(
        automation({
          id: "aut_low_stock",
          label: "Tell me when stock runs low",
          trigger: { type: "record_updated", table: "tbl_products", field: "fld_stock" },
          conditions: [{ field: "fld_stock", op: "lte", value: 3 }],
          actions: [{ type: "notify", to: "owner" }],
        }),
      );
    }
    if (want.has("updates")) {
      automations.push(
        automation({
          id: "aut_shipped",
          label: "Tell the customer their order shipped",
          trigger: { type: "status_changed", table: "tbl_orders", field: "fld_status" },
          conditions: [{ field: "fld_status", op: "eq", value: optId("Shipped") }],
          actions: [{ type: "send_message", channel: "email", to: "fld_customer", template: "tpl_shipped" }],
        }),
      );
    }

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "maker_shop" },
        tables,
        pages,
        automations,
        connections: [],
        modules: ["orders", ...(want.has("stock") ? (["inventory"] as const) : []), ...(want.has("updates") ? (["messaging"] as const) : [])],
      }),
      seed: list(answers, products).map((name) => ({ table: "tbl_products", data: { fld_name: name } })),
    };
  },
};
