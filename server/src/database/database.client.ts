import mongoose from "mongoose";
import { env } from "../config/env.js";

export async function connectDb(url: string = env.mongoUrl): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(url);
}
