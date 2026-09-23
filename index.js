import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

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

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FBangkok`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "weather-mcp-server",
  version: "1.0.0",
});

server.tool(
  "get_current_weather",
  "ดึงสภาพอากาศปัจจุบัน ณ ตำแหน่งที่กำหนด ถ้าไม่ระบุพิกัดจะใช้ตำแหน่งเริ่มต้นของผู้ใช้",
  {
    latitude: z.number().optional().describe("ละติจูด (ไม่ระบุ = ใช้ตำแหน่งเริ่มต้น)"),
    longitude: z.number().optional().describe("ลองจิจูด (ไม่ระบุ = ใช้ตำแหน่งเริ่มต้น)"),
    location_name: z.string().optional().describe("ชื่อสถานที่สำหรับแสดงผล"),
  },
  async ({ latitude, longitude, location_name }) => {
    const hasCustomCoords = latitude !== undefined || longitude !== undefined;
    const lat = latitude ?? DEFAULT_LAT;
    const lon = longitude ?? DEFAULT_LON;
    const name = location_name ?? (hasCustomCoords ? `${lat}, ${lon}` : DEFAULT_LOCATION_NAME);

    try {
      const data = await fetchWeather(lat, lon);
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
      return {
        content: [{ type: "text", text: `เกิดข้อผิดพลาดในการดึงข้อมูลสภาพอากาศ: ${err.message}` }],
        isError: true,
      };
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
