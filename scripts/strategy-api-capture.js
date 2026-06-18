function createCaptureResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function captureHandler(handler, query = {}) {
  const response = createCaptureResponse();
  await handler({ method: "GET", query }, response);
  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(response.headers.entries()),
    body: response.body,
  };
}

module.exports = {
  captureHandler,
  createCaptureResponse,
};
