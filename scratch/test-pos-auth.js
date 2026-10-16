async function main() {
  try {
    console.log('1. Calling POS Auth Login (POST /api/v1/pos/auth/login)...');
    const loginRes = await fetch('http://localhost:3003/api/v1/pos/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': '11111111-1111-1111-1111-111111111111',
        'x-store-id': '22222222-2222-2222-2222-222222222222',
      },
      body: JSON.stringify({ pin: '123456' }),
    });

    const loginData = await loginRes.json();
    console.log('POS Auth Login Status:', loginRes.status);

    if (!loginData.accessToken) {
      console.error('FAILED: No accessToken returned');
      return;
    }

    const token = loginData.accessToken;
    const authHeader = { 'Authorization': `Bearer ${token}` };

    console.log('\n2. Creating a Fast Key (POST /api/v1/fastkeys/create)...');
    const createRes = await fetch('http://localhost:3003/api/v1/fastkeys/create', {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fastkey_title: 'Fastkey One',
        fastkey_index: '1',
      }),
    });
    const createData = await createRes.json();
    console.log('Create Fast Key Status:', createRes.status);
    console.log('Create Fast Key Response:', JSON.stringify(createData, null, 2));

    const fastkeyId = createData.fastkey_id;

    console.log('\n3. Getting Fast Keys By User (GET /api/v1/fastkeys/get-by-user)...');
    const getRes = await fetch('http://localhost:3003/api/v1/fastkeys/get-by-user', {
      method: 'GET',
      headers: authHeader,
    });
    const getData = await getRes.json();
    console.log('Get Fast Keys Status:', getRes.status);
    console.log('Get Fast Keys Count:', getData.fastkeys?.length || 0);

    if (fastkeyId) {
      console.log('\n4. Updating Fast Key Title (POST /api/v1/fastkeys/update-fastkey)...');
      const updateRes = await fetch('http://localhost:3003/api/v1/fastkeys/update-fastkey', {
        method: 'POST',
        headers: {
          ...authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fastkey_id: fastkeyId,
          fastkey_title: 'Fastkey One Updated',
          fastkey_index: '1',
        }),
      });
      const updateData = await updateRes.json();
      console.log('Update Fast Key Status:', updateRes.status);
      console.log('Update Fast Key Response:', JSON.stringify(updateData, null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
