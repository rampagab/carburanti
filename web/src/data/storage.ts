// Storage sul dispositivo: solo localStorage, con il prefisso storico «carburanti:» (non cambiarlo:
// gli utenti perderebbero auto, luoghi e spese). Sempre protetto: in privato o con i dati
// bloccati localStorage può mancare o lanciare eccezioni, e allora si usa il valore di riserva.

export const PREFIX = "carburanti:";

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* pieno o bloccato */
    }
  },
  clearCache(): void {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX + "cache:"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignora */
    }
  },
};
