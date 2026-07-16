import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 處理 CORS 預檢請求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, message } = await req.json()

    if (!token || !message) {
      return new Response(JSON.stringify({ error: 'Missing token or message' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 400 
      })
    }

    // LINE Notify API 要求以 application/x-www-form-urlencoded 格式傳送
    const formData = new URLSearchParams();
    formData.append('message', message);

    const lineRes = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    const result = await lineRes.json();

    return new Response(JSON.stringify({ status: lineRes.status, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: lineRes.status,
    })
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})