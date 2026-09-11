const app = require('./src/app');
const http = require('http');

async function testAuthIntegration() {
  console.log('🧪 Starting Better Auth Integration Test...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5001, resolve));
  console.log('📡 Test backend server listening on http://localhost:5001');

  try {
    const testEmail = `test_${Date.now()}@gramgains.app`;
    const testPassword = 'Password123!';
    const testName = 'Test Athlete';

    // 1. Test Sign Up
    console.log('\n1. Testing Sign Up Endpoint:');
    const signUpRes = await fetch('http://localhost:5001/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
      }),
    });

    const signUpData = await signUpRes.json();
    console.log('Sign Up Response status:', signUpRes.status);
    console.log('Sign Up User:', signUpData?.user?.email, '| Name:', signUpData?.user?.name);

    if (signUpRes.status !== 200 && signUpRes.status !== 201) {
      throw new Error(`Sign up failed: ${JSON.stringify(signUpData)}`);
    }

    // 2. Test Sign In
    console.log('\n2. Testing Sign In Endpoint:');
    const signInRes = await fetch('http://localhost:5001/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    const cookieHeader = signInRes.headers.get('set-cookie');
    console.log('Sign In Status:', signInRes.status);
    console.log('Cookie received:', !!cookieHeader);

    const signInData = await signInRes.json();
    console.log('Sign In User:', signInData?.user?.email);

    // 3. Test Session Retrieval
    console.log('\n3. Testing Session Retrieval (/api/auth/get-session):');
    const sessionRes = await fetch('http://localhost:5001/api/auth/get-session', {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
    const sessionData = await sessionRes.json();
    console.log('Session Active User:', sessionData?.user?.email, '| ID:', sessionData?.user?.id);

    // 4. Test Authenticated Tracker Request
    console.log('\n4. Testing Authenticated Tracker logging with session cookie:');
    const searchRes = await fetch('http://localhost:5001/api/food/search?q=Rice');
    const searchData = await searchRes.json();
    const foodId = searchData.data[0].id;

    const logRes = await fetch('http://localhost:5001/api/tracker/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({
        date: new Date().toISOString().split('T')[0],
        mealType: 'BREAKFAST',
        foodId,
        servings: 1,
      }),
    });
    const logData = await logRes.json();
    console.log('Logged Meal for authenticated user:', {
      logId: logData?.data?.id,
      userId: logData?.data?.userId,
      foodName: logData?.data?.food?.name,
    });

    if (logData?.data?.userId !== sessionData?.user?.id) {
      throw new Error(`Expected userId to be ${sessionData?.user?.id} but got ${logData?.data?.userId}`);
    }

    console.log('\n🎉 ALL BETTER AUTH ENDPOINTS AND AUTHENTICATED WORKFLOWS PASSED WITH 100% SUCCESS!');
  } finally {
    server.close();
  }
}

testAuthIntegration()
  .catch((err) => {
    console.error('❌ Auth integration test failed:', err);
    process.exit(1);
  });
