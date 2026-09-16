import express from "express";
import dotenv from "dotenv";
import authRouter from "./routes/auth";
import tablesRouter from "./routes/tables";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/tables", tablesRouter);

app.listen(port, () => {
  console.log(`Mesas Vivas backend escuchando en http://localhost:${port}`);
});