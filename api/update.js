export default async function handler(req, res) {
  // Allow both GET and POST for easy browser access
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Manual update initiated...');

    // Call the populate endpoint to trigger bootstrap or incremental update
    const populateUrl = `${req.headers.host?.includes('localhost') ? 'http' : 'https'}://${req.headers.host}/api/tokens/populate`;
    
    const populateResponse = await fetch(populateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'default-secret'}`
      },
      body: JSON.stringify({
        manual: true
      })
    });

    const result = await populateResponse.json();

    console.log('Manual update complete:', result);

    // Return HTML response for browser access
    if (req.method === 'GET') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>SpineTracker - Manual Update</title>
          <style>
            body { 
              font-family: 'Segoe UI', sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px;
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
              color: #e0e0e0;
              min-height: 100vh;
            }
            .success { 
              color: #06ffa5; 
              background: rgba(6, 255, 165, 0.1); 
              padding: 20px; 
              border-radius: 10px;
              border: 1px solid rgba(6, 255, 165, 0.3);
            }
            .error { 
              color: #ff6b6b; 
              background: rgba(255, 107, 107, 0.1); 
              padding: 20px; 
              border-radius: 10px;
              border: 1px solid rgba(255, 107, 107, 0.3);
            }
            pre { 
              background: rgba(255, 255, 255, 0.1); 
              padding: 15px; 
              border-radius: 8px; 
              overflow-x: auto;
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            a {
              color: #06ffa5;
              text-decoration: none;
              font-weight: 500;
            }
            a:hover {
              text-decoration: underline;
            }
            h1 {
              background: linear-gradient(45deg, #9d4edd, #6a4c93, #3a86ff);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
            }
          </style>
        </head>
        <body>
          <h1>SpineTracker Token Library Update</h1>
          ${result.success ? 
            `<div class="success">
              <h3>Update Successful!</h3>
              <p><strong>${result.message}</strong></p>
              ${result.bootstrap ? '<p>Bootstrap completed! All historical tokens have been loaded into the database.</p>' : ''}
              ${result.results ? `
                <ul>
                  <li>Processed: ${result.results.processed} transactions</li>
                  <li>Added: ${result.results.added} new tokens</li>
                  <li>Skipped: ${result.results.skipped} existing tokens</li>
                </ul>
              ` : ''}
              <p><strong><a href="/token-library.html">View Token Library Database</a></strong></p>
            </div>` :
            `<div class="error">
              <h3>Update Failed</h3>
              <p>${result.error || 'Unknown error'}</p>
            </div>`
          }
          <details>
            <summary>Technical Details</summary>
            <pre>${JSON.stringify(result, null, 2)}</pre>
          </details>
          <p><a href="https://spinetracker.vercel.app/">Back to SpineTracker</a></p>
        </body>
        </html>
      `);
    }

    // JSON response for API calls
    return res.status(200).json({
      success: true,
      manual: true,
      timestamp: new Date().toISOString(),
      ...result
    });

  } catch (error) {
    console.error('Manual update failed:', error);
    
    const errorResponse = { 
      success: false,
      error: 'Manual update failed',
      details: error.message,
      timestamp: new Date().toISOString()
    };

    if (req.method === 'GET') {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Update Failed</title></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>Update Failed</h1>
          <p>${error.message}</p>
          <p><a href="https://spinetracker.vercel.app/">Back to SpineTracker</a></p>
        </body>
        </html>
      `);
    }

    return res.status(500).json(errorResponse);
  }
}
