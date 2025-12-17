from app import app
import awsgi

def handler(event, context):
    return awsgi.response(app, event, context, base64_content_types={"audio/wav", "audio/x-wav", "multipart/form-data"})
