import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----- ตำแหน่งเริ่มต้น (แก้ได้ตามต้องการ หรือ override ผ่าน parameter ตอนเรียก tool) -----
const DEFAULT_LAT = 13.60;
const DEFAULT_LON = 100.72421;
const DEFAULT_LOCATION_NAME = "สมุทรปราการ (บางปลา)";

const WEATHER_CODES = {
  0: "ท้องฟ้าแจ่มใส",
  1: "แจ่มใสเป็นส่วนใหญ่",
  2: "มีเมฆบางส่วน",
  3: "มีเมฆมาก",
  45: "หมอก",
  48: "หมอกน้ำแข็งเกาะ",
  51: "ฝนละอองเบา",
  53: "ฝนละอองปานกลาง",
  55: "ฝนละอองหนัก",
  61: "ฝนตกเบา",
  63: "ฝนตกปานกลาง",
  65: "ฝนตกหนัก",
  71: "หิมะตกเบา",
  73: "หิมะตกปานกลาง",
  75: "หิมะตกหนัก",
  80: "ฝนซู่เบา",
  81: "ฝนซู่ปานกลาง",
  82: "ฝนซู่หนัก",
  95: "พายุฝนฟ้าคะนอง",
  96: "พายุฝนฟ้าคะนองมีลูกเห็บเบา",
  99: "พายุฝนฟ้าคะนองมีลูกเห็บหนัก",
};

function describeCode(code) {
  return WEATHER_CODES[code] ?? `ไม่ทราบสภาพอากาศ (code ${code})`;
}

function resolveLocation(latitude, longitude, location_name) {
  const hasCustomCoords = latitude !== undefined || longitude !== undefined;
  const lat = latitude ?? DEFAULT_LAT;
  const lon = longitude ?? DEFAULT_LON;
  const name = location_name ?? (hasCustomCoords ? `${lat}, ${lon}` : DEFAULT_LOCATION_NAME);
  return { lat, lon, name };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "weather-mcp-server",
  version: "2.0.0",
});

// ---------- 1) สภาพอากาศปัจจุบัน ----------
server.tool(
  "get_current_weather",
  "ดึงสภาพอากาศปัจจุบัน ณ ตำแหน่งที่กำหนด ถ้าไม่ระบุพิกัดจะใช้ตำแหน่งเริ่มต้นของผู้ใช้",
  {
    latitude: z.number().optional().describe("ละติจูด (ไม่ระบุ = ใช้ตำแหน่งเริ่มต้น)"),
    longitude: z.number().optional().describe("ลองจิจูด (ไม่ระบุ = ใช้ตำแหน่งเริ่มต้น)"),
    location_name: z.string().optional().describe("ชื่อสถานที่สำหรับแสดงผล"),
  },
  async ({ latitude, longitude, location_name }) => {
    const { lat, lon, name } = resolveLocation(latitude, longitude, location_name);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FBangkok`;
      const data = await fetchJson(url);
      const c = data.current;
      const text = [
        `สภาพอากาศที่ ${name}`,
        `อุณหภูมิ: ${c.temperature_2m}°C (รู้สึกเหมือน ${c.apparent_temperature}°C)`,
        `สภาพ: ${describeCode(c.weather_code)}`,
        `ความชื้น: ${c.relative_humidity_2m}%`,
        `ปริมาณฝน: ${c.precipitation} มม.`,
        `ความเร็วลม: ${c.wind_speed_10m} กม./ชม.`,
        `เวลาอัปเดต: ${c.time}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message}` }], isError: true };
    }
  }
);

// ---------- 2) พยากรณ์รายชั่วโมง ----------
server.tool(
  "get_hourly_forecast",
  "พยากรณ์อากาศล่วงหน้าแบบรายชั่วโมง (ค่าเริ่มต้น 24 ชั่วโมงถัดไป)",
  {
    hours: z.number().int().min(1).max(48).optional().describe("จำนวนชั่วโมงล่วงหน้า (1-48, ค่าเริ่มต้น 24)"),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    location_name: z.string().optional(),
  },
  async ({ hours, latitude, longitude, location_name }) => {
    const n = hours ?? 24;
    const { lat, lon, name } = resolveLocation(latitude, longitude, location_name);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=${n}&timezone=Asia%2FBangkok`;
      const data = await fetchJson(url);
      const h = data.hourly;
      const lines = [`พยากรณ์รายชั่วโมงที่ ${name} (${n} ชม. ถัดไป)`];
      for (let i = 0; i < h.time.length; i++) {
        const t = h.time[i].split("T")[1];
        lines.push(
          `${t} — ${h.temperature_2m[i]}°C, ${describeCode(h.weather_code[i])}, โอกาสฝน ${h.precipitation_probability[i]}%`
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message}` }], isError: true };
    }
  }
);

// ---------- 3) พยากรณ์รายวัน ----------
server.tool(
  "get_daily_forecast",
  "พยากรณ์อากาศล่วงหน้าแบบรายวัน (ค่าเริ่มต้น 7 วันถัดไป)",
  {
    days: z.number().int().min(1).max(16).optional().describe("จำนวนวันล่วงหน้า (1-16, ค่าเริ่มต้น 7)"),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    location_name: z.string().optional(),
  },
  async ({ days, latitude, longitude, location_name }) => {
    const n = days ?? 7;
    const { lat, lon, name } = resolveLocation(latitude, longitude, location_name);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&forecast_days=${n}&timezone=Asia%2FBangkok`;
      const data = await fetchJson(url);
      const d = data.daily;
      const lines = [`พยากรณ์รายวันที่ ${name} (${n} วันถัดไป)`];
      for (let i = 0; i < d.time.length; i++) {
        lines.push(
          `${d.time[i]} — ${describeCode(d.weather_code[i])}, สูงสุด ${d.temperature_2m_max[i]}°C ต่ำสุด ${d.temperature_2m_min[i]}°C, ฝนสะสม ${d.precipitation_sum[i]}มม. (โอกาส ${d.precipitation_probability_max[i]}%)`
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message}` }], isError: true };
    }
  }
);

// ---------- 4) ค้นหาสถานที่ (geocoding) ----------
server.tool(
  "search_location",
  "ค้นหาชื่อสถานที่เพื่อหาพิกัดละติจูด/ลองจิจูด ใช้ร่วมกับ tool อื่นเพื่อดูอากาศที่ไหนก็ได้ในโลก",
  {
    query: z.string().describe("ชื่อเมืองหรือสถานที่ที่จะค้นหา"),
  },
  async ({ query }) => {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=th&format=json`;
      const data = await fetchJson(url);
      if (!data.results || data.results.length === 0) {
        return { content: [{ type: "text", text: `ไม่พบสถานที่ที่ตรงกับ "${query}"` }] };
      }
      const lines = data.results.map(
        (r) =>
          `${r.name}${r.admin1 ? ", " + r.admin1 : ""}, ${r.country} — lat: ${r.latitude}, lon: ${r.longitude}`
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message}` }], isError: true };
    }
  }
);

// ---------- 5) คุณภาพอากาศ ----------
server.tool(
  "get_air_quality",
  "ดึงข้อมูลคุณภาพอากาศปัจจุบัน (PM2.5, PM10, ดัชนีคุณภาพอากาศ) ณ ตำแหน่งที่กำหนด",
  {
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    location_name: z.string().optional(),
  },
  async ({ latitude, longitude, location_name }) => {
    const { lat, lon, name } = resolveLocation(latitude, longitude, location_name);
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,us_aqi,european_aqi&timezone=Asia%2FBangkok`;
      const data = await fetchJson(url);
      const c = data.current;
      const text = [
        `คุณภาพอากาศที่ ${name}`,
        `PM2.5: ${c.pm2_5} µg/m³`,
        `PM10: ${c.pm10} µg/m³`,
        `US AQI: ${c.us_aqi}`,
        `European AQI: ${c.european_aqi}`,
        `เวลาอัปเดต: ${c.time}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message}` }], isError: true };
    }
  }
);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message || "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/", (req, res) => {
  res.send("Weather MCP Server is running. POST to /mcp");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Weather MCP server listening on port ${PORT}`);
});
