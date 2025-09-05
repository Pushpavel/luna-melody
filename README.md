# Luna Melody

Luna Melody is a full-stack music web application for piano transcription and MIDI visualization. It features a modern React frontend and a FastAPI backend, both served together on `localhost:8000`. Users can upload MIDI files, or provide a YouTube video link. The backend will automatically transcribe audio into MIDI using state-of-the-art deep learning model, allowing users to interactively explore and visualize the results.

## Features

- 📁 MIDI file upload
- 🎥 YouTube link to MIDI file
- ▶️ MIDI player
- 🌟 Reactive background (reacts to the music's intensity)

## Demo

https://github.com/user-attachments/assets/ed852462-bb69-444a-8919-10060871b7c8

## Prerequisites

- [FFmpeg](https://ffmpeg.org/download.html) (must be in your PATH)
- [Node.js](https://nodejs.org/) (includes npm)
- [uv](https://github.com/astral-sh/uv) (Python package manager)

## Setup Instructions

### 1. Backend Setup

Open a terminal and run:

```sh
cd backend
uv sync
```

This will install all Python dependencies using `uv`.

### 2. Frontend Setup

From the project root, run:

```sh
npm i
npm run build
```

This installs Node.js dependencies and builds the frontend.

### 3. Run the Server

Start the backend server (serves both frontend and API):

```sh
uv run fastapi run main.py
```

The app will be available at [http://localhost:8000](http://localhost:8000).

---

## Notes

- Ensure FFmpeg is installed and accessible from your terminal.
- For development, you may want to use `npm run dev` for hot-reloading the frontend (served separately).

## Technology Stack

| Layer      | Tech / Library                | Description                          |
|------------|------------------------------|--------------------------------------|
| Frontend   | Vite                         | Build tool for fast development      |
|            | React                        | UI library                           |
|            | TypeScript                   | Typed JavaScript                     |
|            | shadcn-ui                    | UI components                        |
|            | Tailwind CSS                 | Utility-first CSS framework          |
| Backend    | FastAPI                      | Python web framework (API + static)  |
|            | uv                           | Python package manager               |
|            | FFmpeg                       | Audio processing (system dependency) |
|            | piano_transcription_interface | Piano transcription (uses PyTorch)   |
|            | PyTorch                      | Deep learning library (dependency)   |

---

## Cite

This project uses the `piano_transcription_interface` library for automatic piano transcription, which is based on the research paper below.

[1] Qiuqiang Kong, Bochen Li, Xuchen Song, Yuan Wan, and Yuxuan Wang. "High-resolution Piano Transcription with Pedals by Regressing Onsets and Offsets Times." arXiv preprint arXiv:2010.01815 (2020). [[pdf]](https://arxiv.org/pdf/2010.01815.pdf)
