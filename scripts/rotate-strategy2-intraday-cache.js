const { rotateStrategy2IntradayCache } = require("./strategy2-cache-rotation");

const currentDateKey = process.env.STRATEGY2_ROTATION_CURRENT_DATE
  || new Date().toISOString().slice(0, 10);

const messages = rotateStrategy2IntradayCache({
  currentDateKey,
  archiveStaticLatestCopies: true,
});

if (messages.length) {
  messages.forEach((message) => console.log(message));
} else {
  console.log("strategy2 cache rotation: nothing to rotate");
}
