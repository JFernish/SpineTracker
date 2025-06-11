# Dynamic Spine Token Tracker

Automatically discover CC7 factory token spines by walking up from any child token on PulseChain.

## 🚀 Features

- **Automatic Spine Discovery**: Enter any CC7 child token and automatically discover the entire parent-child chain
- **Real-time Price Data**: Live pricing from GeckoTerminal and DexScreener APIs
- **Multiplier Reading**: Reads multiplier values directly from smart contracts
- **Auto-refresh**: Configurable auto-refresh for live monitoring
- **Mobile Responsive**: Works great on desktop and mobile devices

## 🛠️ How It Works

1. **Enter a CC7 Token Address**: Start with any CC7 child token address
2. **Discover the Spine**: The tool walks up the parent chain to find all related tokens
3. **Load Live Data**: Fetches real-time prices, multipliers, and market cap data
4. **Monitor**: Use auto-refresh to keep data current

## 🔧 Configuration

- **RPC URL**: Default uses G4mm4.io PulseChain RPC
- **Auto-refresh**: Configurable interval (10-600 seconds)
- **Starting Token**: Any CC7 child token address

## 📱 Usage

1. Visit the live site
2. Optionally test your RPC connection
3. Enter a CC7 child token address
4. Click "Discover CC7 Spine"
5. Click "Refresh Data" to load current prices and multipliers

## ⚠️ Disclaimer

This tool is for entertainment purposes only. All data should be independently verified before making any financial decisions. Always DYOR (Do Your Own Research).

## 🌐 Live Demo

[View Live Site](https://your-vercel-url.vercel.app)

## 🤝 Support

If you find this tool helpful, consider supporting development:

```
0x809b15CCdC92882035C274738318296525b98aD8
```

## 📄 License

MIT License - see LICENSE file for details.

---

**Chain**: PulseChain (Chain ID: 369)  
**Built for**: CC7 Factory Tokens  
**APIs**: GeckoTerminal, DexScreener