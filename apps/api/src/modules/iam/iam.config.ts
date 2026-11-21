/** Settings the IAM module needs. Supplied by the composition root from AppConfig.auth. */
export interface IamConfig {
  sessionTtlHours: number;
  sessionIdleTimeoutMinutes: number;
  cookieName: string;
  cookieSecure: boolean;
}
