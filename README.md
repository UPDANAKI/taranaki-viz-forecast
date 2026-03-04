# 🐟 Taranaki Viz Forecast

Real-time spearfishing visibility predictions for 6 spots around the Taranaki coast, New Zealand.

## Features
- Per-spot scoring combining swell, wind, rain history, ocean current, SST, and satellite data
- 7-day visibility forecast + wind forecast per spot
- NASA GIBS satellite imagery with turbidity sampling
- Community dive logging via Supabase
- Share with your crew via WhatsApp, text, or link

## Deploy
Push to GitHub then connect to [Netlify](https://netlify.com) or [Vercel](https://vercel.com) — both auto-detect Vite and deploy for free.

## Data Sources
- Open-Meteo (weather + marine)
- NOAA RTOFS HYCOM (ocean currents)
- NASA GIBS (satellite imagery)
- Supabase (community dive logs)
