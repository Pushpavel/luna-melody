import os
import yt_dlp
import logging

# Configure logging
logger = logging.getLogger(__name__)

# yt-dlp options
ydl_opts = {
    # Set postprocessors to use ffmpeg for audio extraction and trimming
    'postprocessors': [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '192', # Audio quality
    }, {
        'key': 'FFmpegSubtitlesConvertor',
        'format': 'srt'
    }],

    # Specify the download time range
    # 'download_ranges': yt_dlp.utils.download_range_func(None, [(START_TIME, END_TIME)]),

    # Define the output filename template
    'outtmpl': ".downloads/%(id)s.%(ext)s",

    # Force overwrite of existing files
    'overwrites': True,
    
    # Enable partial download to handle interruptions
    'part': True,  

    # Select the best audio-only format
    'format': 'bestaudio/best',
}


def download_youtube_clip(youtube_url: str):
    """
    Downloads a YouTube video as an audio file using yt-dlp and returns the file path and title.
    If the file already exists, skips download and returns the existing file path and title.
    Args:
        youtube_url (str): The URL of the YouTube video to download.
    Returns:
        Tuple[str, str]: The path to the downloaded audio file and the video title.
    Raises:
        ValueError: If video information cannot be retrieved.
    """
    logger.info(f"Attempting to download YouTube audio from URL: {youtube_url}")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        # Get video info to determine the correct filename
        info = ydl.extract_info(youtube_url, download=False)
        if info is None:
            logger.error("Failed to retrieve video information.")
            raise ValueError("Failed to retrieve video information.")
        # Construct the expected output filename
        output_filename = ydl.prepare_filename(info).replace('.webm', '.mp3').replace('.m4a', '.mp3')

        if os.path.exists(output_filename):
            logger.info(f"File '{output_filename}' already exists. Skipping download.")
            return output_filename, info['title']
        # Download the video clip
        ydl.download([youtube_url])
        logger.info(f"Successfully downloaded and trimmed video clip to '{output_filename}'")
        return output_filename, info['title']