const admin = require('firebase-admin');

/**
 * Firestore from FIREBASE_SERVICE_ACCOUNT (raw JSON or base64), shared by
 * every sync script. Initializes the app once.
 */
function initializeFirebase() {
  if (admin.apps.length) return admin.firestore();

  const rawFirebaseEnv = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!rawFirebaseEnv) throw new Error("🚨 FIREBASE_SERVICE_ACCOUNT environment variable is completely empty or missing!");

  let serviceAccount;
  try {
    if (rawFirebaseEnv.trim().startsWith('{')) {
      serviceAccount = JSON.parse(rawFirebaseEnv);
    } else {
      serviceAccount = JSON.parse(Buffer.from(rawFirebaseEnv, 'base64').toString('utf8'));
    }

    // Safely fix escaped newlines inside the private key so Firebase auth doesn't crash with 16 UNAUTHENTICATED
    if (serviceAccount && serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } catch (e) {
    throw new Error(`🚨 FIREBASE_SERVICE_ACCOUNT exists but contains invalid JSON. Length: ${rawFirebaseEnv.length}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin.firestore();
}

module.exports = { initializeFirebase, admin };
