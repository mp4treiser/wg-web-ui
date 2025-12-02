import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("VITE_API_URL is not defined. Set it in your environment (.env).");
}

export const API_BASE_URL = API_URL;

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

export interface Server {
  id: number;
  name: string;
  base_url: string;
  username: string;
  last_status_ok: boolean;
  last_checked_at?: string;
  last_error?: string | null;
}

export interface LogicalUser {
  id: number;
  name: string;
  note?: string | null;
  created_at: string;
}

export interface UserServerBinding {
  id: number;
  server_id: number;
  wg_client_id: number;
  wg_client_name: string;
  expires_at?: string | null;
  created_at: string;
  enabled?: boolean | null;
}


