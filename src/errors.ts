export class ChaironError extends Error {
  override name = "ChaironError";
}

export class LoginError extends ChaironError {
  override name = "LoginError";
  readonly code: number;

  constructor(code: number) {
    super(`Login failed with code ${code}. Check the username and password.`);
    this.code = code;
  }
}

export class HTTPError extends ChaironError {
  override name = "HTTPError";
  readonly status: number;
  readonly path: string;

  constructor(path: string, status: number) {
    super(`${path} responded with HTTP ${status}.`);
    this.status = status;
    this.path = path;
  }
}
