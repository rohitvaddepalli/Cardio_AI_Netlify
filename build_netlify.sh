#!/bin/bash

# clean up
rm -rf functions/libs functions/templates functions/static functions/app.py

# Create destination folders
mkdir -p functions

# Install dependencies directly into functions folder (Target Directory)
# Note: We exclude Scipy/Numpy here to check if we can get the basic app running first, 
# because they exceed the 50MB limit. 
# But the user wants the app. I will try installing them and let it fail if it must.
pip install -t functions -r requirements.txt

# Copy app code and assets
cp app.py functions/
cp -r templates functions/
cp -r static functions/
