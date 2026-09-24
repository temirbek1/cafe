const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const pool = require("./db");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/orders");
const menuRoutes = require("./routes/menu");
const tableRoutes = require("./routes/tables");
const shiftRoutes = require("./routes/shifts");

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const io = new Server(server, { cors: { origin: corsOrigin } });

app.use(express.json());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.set("io", io);

app.get("/cashier", (req, res) => res.sendFile(path.join(__dirname, "..", "cashier.html")));
// A database-free presentation screen. It is intentionally separate from the real POS.
app.get("/demo", (req, res) => res.sendFile(path.join(__dirname, "..", "demo.html")));

app.use("/auth", authRoutes);
app.use("/orders", orderRoutes);
app.use("/menu", menuRoutes);
app.use("/tables", tableRoutes);
app.use("/shifts", shiftRoutes);

app.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW() AS time");
    res.json({ message: "Cafe POS API is running", time: result.rows[0].time });
  } catch (err) {
    next(err);
  }
});

io.on("connection", (socket) => console.log("POS client connected:", socket.id));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

server.listen(port, () => console.log(`Cafe POS server running on ${port}`));
