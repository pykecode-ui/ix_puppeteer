const ixbrowser = require('./src/api/ixbrowser');

async function test() {
  try {
    const data = await ixbrowser.listOpenedProfiles();
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
