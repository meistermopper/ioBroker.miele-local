const path = require('node:path');
const http = require('node:http');
const { tests } = require('@iobroker/testing');

// Run integration tests: starts a temporary js-controller instance, installs the adapter
// and verifies that it starts up cleanly (no config required — the adapter must not crash
// when no credentials/devices are configured yet).
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        // Der Zeitdienst laeuft auch ohne GroupKey - und muss die Miele-Anfrage beantworten.
        suite('Time server', getHarness => {
            it('answers GET /V2/NTP/ and counts the request', async function () {
                this.timeout(60000);
                const harness = getHarness();
                const port = 18780;
                await harness.changeAdapterConfig('miele-local', {
                    native: { timeServer: true, timeServerPort: port, timeServerBind: '127.0.0.1' },
                });
                await harness.startAdapterAndWait();
                await new Promise(r => setTimeout(r, 2000));
                const antwort = await new Promise((resolve, reject) => {
                    http.get(
                        { host: '127.0.0.1', port, path: '/V2/NTP/', headers: { Host: 'ntp.mcs2.miele.com' } },
                        res => {
                            let d = '';
                            res.on('data', c => (d += c));
                            res.on('end', () => resolve({ status: res.statusCode, body: d }));
                        },
                    ).on('error', reject);
                });
                if (antwort.status !== 200) {
                    throw new Error(`HTTP ${antwort.status}`);
                }
                const zeit = JSON.parse(antwort.body).time;
                if (Math.abs(zeit - Date.now() / 1000) > 5) {
                    throw new Error(`time off: ${zeit}`);
                }
                await new Promise(r => setTimeout(r, 1000));
                const st = await harness.states.getStateAsync('miele-local.0.info.timeServer.requests');
                if (!st || st.val !== 1) {
                    throw new Error(`requests = ${st && st.val}`);
                }
                const lauf = await harness.states.getStateAsync('miele-local.0.info.timeServer.running');
                if (!lauf || lauf.val !== true) {
                    throw new Error('running is not true');
                }
            });
        });
    },
});
