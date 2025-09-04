from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
from sse_starlette.sse import EventSourceResponse
from sse_starlette import JSONServerSentEvent
import helpers
import librosa
from piano_transcription_inference import PianoTranscription, sample_rate
import logging

app = FastAPI()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Allow CORS for local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/process")
def process(url: str, request: Request):
    """
    Downloads audio from a YouTube URL, transcribes it to MIDI using a piano transcription model,
    and streams progress events to the client. If the MIDI file already exists, skips transcription.
    Args:
        url (str): The YouTube video URL to process.
        request (Request): The FastAPI request object.
    Returns:
        EventSourceResponse: SSE stream of progress and completion events.
    """
    def event_stream():
        # Download YouTube audio from 'url'
        logger.info(f"Starting download for URL: {url}")
        yield JSONServerSentEvent(
            {"type": "progress", "step": "Downloading...", "progress": 0}
        )
        audio_path, title = helpers.download_youtube_clip(url)
        logger.info(f"Download complete. Audio path: {audio_path}, Title: {title}")
        yield JSONServerSentEvent(
            {
                "type": "progress",
                "step": "Download complete. Loading the audio for transcription...",
                "progress": 30,
            }
        )
        midi_path = audio_path + ".mid"
        
        if os.path.exists(midi_path):
            logger.info(f"MIDI file already exists at {midi_path}. Skipping transcription.")
            yield JSONServerSentEvent({
                "type": "complete",
                "title": title,
                "midiPath": midi_path,
            })
            return
        
        # Load audio
        logger.info(f"Loading audio from {audio_path}")
        audio, _ = librosa.load(path=audio_path, sr=sample_rate, mono=True)

        # Transcriptor
        yield JSONServerSentEvent(
            {
                "type": "progress",
                "step": "Initializing transcription model...",
                "progress": 40,
            }
        )
        logger.info("Initializing PianoTranscription model on CUDA device.")
        transcriptor = PianoTranscription(
            device="cuda", checkpoint_path=None
        )  # device: 'cuda' | 'cpu'

        # Transcribe and write out to MIDI file
        yield JSONServerSentEvent(
            {
                "type": "progress",
                "step": "Transcribing audio to MIDI...",
                "progress": 50,
            }
        )
        logger.info(f"Transcribing audio to MIDI at {midi_path}")
        transcriptor.transcribe(audio, midi_path)
        logger.info(f"Transcription complete. MIDI saved at {midi_path}")
        yield JSONServerSentEvent(
            {
                "type": "complete",
                "title": title,
                "midiPath": midi_path,
            }
        )
        return

    return EventSourceResponse(event_stream())


@app.get("/download/{midi_path:path}")
async def download(midi_path: str):
    """
    Serves a MIDI file for download from the given path.
    Args:
        midi_path (str): Path to the MIDI file to download.
    Returns:
        FileResponse: Response containing the MIDI file.
    """
    logger.info(f"Downloading MIDI file from path: {midi_path}")
    return FileResponse(midi_path, media_type="audio/midi", filename="output.mid")
