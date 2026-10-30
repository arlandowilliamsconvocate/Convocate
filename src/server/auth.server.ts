/**
 * Authentication: password hashing (Bun's built-in), cookie sessions, and the
 * current-user lookup every server function funnels through.
 *
 * Async throughout: the data layer is libSQL, so every session/user call is a
 * promise. `startSession` / `endSession` / `currentUser` all await.
 */
import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import {
  createSession,
  createUser,
  deleteSession,
  findSessionUser,
  findUserByEmail,
  type User,
} from "./db.server";

const COOKIE_NAME = "convocate_session";
const SESSION_DAYS = 30;

export const startSession = async (userId: number): Promise<void> => {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await createSession(userId, token, expiresAt);
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
};

export const endSession = async (): Promise<void> => {
  const token = getCookie(COOKIE_NAME);
  if (token) await deleteSession(token);
  deleteCookie(COOKIE_NAME, { path: "/" });
};

export const currentUser = async (): Promise<User | null> => {
  const token = getCookie(COOKIE_NAME);
  if (!token) return null;
  return await findSessionUser(token);
};

/**
 * The signed-in account for a plain `Request` — for route handlers, which get the
 * request and not the server-function context `getCookie` reads.
 *
 * Same cookie, same session table, same expiry check as `currentUser`: there is
 * one way to be signed in, and this is it seen from a handler's side. A missing or
 * malformed cookie is simply "nobody", never an error.
 */
export const userFromRequest = async (request: Request): Promise<User | null> => {
  const header = request.headers.get("cookie") ?? "";
  const token = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!token) return null;
  return await findSessionUser(decodeURIComponent(token));
};

export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password);

export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  Bun.password.verify(password, hash);

export const registerUser = async (
  email: string,
  name: string,
  password: string,
): Promise<User> => {
  const passwordHash = await hashPassword(password);
  return await createUser(email, name, passwordHash);
};

export const authenticate = async (email: string, password: string): Promise<User | null> => {
  const found = await findUserByEmail(email);
  if (!found) return null;
  const ok = await verifyPassword(password, found.passwordHash);
  if (!ok) return null;
  return { id: found.id, email: found.email, name: found.name };
};
