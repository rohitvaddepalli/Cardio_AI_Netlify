import sys
import os

# Add project root to system path so we can import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app
import awsgi

def handler(event, context):
    return awsgi.response(app, event, context, base64_content_types={"audio/wav", "audio/x-wav", "multipart/form-data"})
