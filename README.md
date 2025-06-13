# DuggAI Desktop App

DuggAI is an intelligent desktop application that helps developers generate and manage coding projects using AI. It provides a user-friendly interface for creating, running, and managing projects with the help of advanced AI models.

## Features

- 🤖 AI-powered project generation
- 📝 Code analysis and understanding
- 🔍 Intelligent code search
- 🏃‍♂️ Project running and testing
- 📦 Project export and sharing
- 🎨 Modern, glassy UI design

## Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- OpenRouter API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/MOAB1184/duggai.git
cd duggai
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your OpenRouter API key:
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

4. Start the application:
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## Building

To build the application for your platform:

```bash
# Windows
npm run build:win

# All platforms
npm run build
```

## Development

- `npm run dev` - Start the app in development mode
- `npm test` - Run tests
- `npm run build` - Build the app
- `npm run build:win` - Build for Windows

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Electron](https://www.electronjs.org/)
- [OpenRouter](https://openrouter.ai/)
- [Node.js](https://nodejs.org/) 