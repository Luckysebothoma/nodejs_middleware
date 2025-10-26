import crypto from "crypto";

export const hashToken = (token) => {
  if (typeof token !== "string" && !Buffer.isBuffer(token)) {
    console.warn("⚠️ hashToken called with invalid token:", token);
    return null; // or throw new Error("Invalid token for hashing")
  }

  return crypto.createHash("sha256").update(token).digest("hex");
};

export const getTTL = (exp) => {
  if (!exp || isNaN(exp)) {
    console.warn("⚠️ getTTL called with invalid exp:", exp);
    return 0;
  }

  return Math.floor((exp * 1000 - Date.now()) / 1000);
};
