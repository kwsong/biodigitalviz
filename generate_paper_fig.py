import json
import requests
from PIL import Image
from io import BytesIO
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from urllib.parse import urlparse
import os

# Load the JSON data
with open('systemslist.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Configuration
COLS = 12
ROWS = 6
THUMB_SIZE = 150  # Size of each thumbnail in pixels
SPACING = 5  # Spacing between images
FIG_DPI = 150  # DPI for the output figure

def get_image_url(img_name):
    """Convert image name to URL if needed"""
    if not img_name:
        return None
    
    # Check if it's already a URL
    if img_name.startswith('http://') or img_name.startswith('https://'):
        return img_name
    else:
        # It's a filename, construct the URL
        return f"https://kwsong.github.io/biodigitalviz/images/{img_name}"

def download_image(url, max_retries=3):
    """Download image from URL with retry logic"""
    if not url:
        return None
    
    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=10, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            if response.status_code == 200:
                img = Image.open(BytesIO(response.content))
                # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                return img
        except Exception as e:
            print(f"Failed to download {url} (attempt {attempt + 1}): {e}")
    
    return None

def crop_center_square(img, target_size):
    """Crop image to square from center and resize to target size"""
    width, height = img.size
    
    # Calculate the size of the square crop (use the smaller dimension)
    crop_size = min(width, height)
    
    # Calculate crop coordinates to center the crop
    left = (width - crop_size) // 2
    top = (height - crop_size) // 2
    right = left + crop_size
    bottom = top + crop_size
    
    # Crop to square and resize
    img_cropped = img.crop((left, top, right, bottom))
    img_resized = img_cropped.resize((target_size, target_size), Image.Resampling.LANCZOS)
    
    return img_resized

def create_placeholder(text="No Image"):
    """Create a placeholder image for missing thumbnails"""
    img = Image.new('RGB', (THUMB_SIZE, THUMB_SIZE), color='lightgray')
    return img

# Prepare figure
fig_width = COLS * (THUMB_SIZE + SPACING) / FIG_DPI
fig_height = ROWS * (THUMB_SIZE + SPACING) / FIG_DPI
fig, axes = plt.subplots(ROWS, COLS, figsize=(fig_width, fig_height), dpi=FIG_DPI)
fig.patch.set_facecolor('white')

# Flatten axes array for easier indexing
axes_flat = axes.flatten()

# Hide all axes initially
for ax in axes_flat:
    ax.axis('off')

# Process each system
successful_downloads = 0
failed_downloads = []

for idx, system in enumerate(data['data'][:72]):  # Limit to 72 systems (6x12 grid)
    ax = axes_flat[idx]
    
    # Get image URL
    img_url = get_image_url(system.get('img_name', ''))
    
    # Download and display image
    img = download_image(img_url)
    
    if img:
        # Crop to square from center and resize to exact thumbnail size
        final_img = crop_center_square(img, THUMB_SIZE)
        ax.imshow(final_img)
        successful_downloads += 1
    else:
        # Use placeholder
        placeholder = create_placeholder(system.get('name', 'Unknown')[:15])
        ax.imshow(placeholder)
        failed_downloads.append(system.get('name', 'Unknown'))
    
    # Add subtle border
    rect = patches.Rectangle((0, 0), THUMB_SIZE-1, THUMB_SIZE-1, 
                            linewidth=0.5, edgecolor='#cccccc', facecolor='none')
    ax.add_patch(rect)
    
    # Optional: Add system name as title (comment out if not needed)
    # ax.set_title(system.get('name', '')[:20], fontsize=6, pad=2)
    
    ax.set_xlim(0, THUMB_SIZE)
    ax.set_ylim(THUMB_SIZE, 0)  # Invert y-axis for proper image orientation

# Adjust spacing - minimal spacing between thumbnails
plt.subplots_adjust(left=0.005, right=0.995, top=0.995, bottom=0.005, 
                    wspace=0.01, hspace=0.01)

# Save the figure
output_filename = 'bio_digital_systems_thumbnails.png'
plt.savefig(output_filename, dpi=FIG_DPI, bbox_inches='tight', 
            pad_inches=0.05, facecolor='white')
plt.close()

print(f"\nThumbnail grid saved as '{output_filename}'")
print(f"Successfully downloaded: {successful_downloads}/72 images")
if failed_downloads:
    print(f"Failed to download images for: {', '.join(failed_downloads[:5])}")
    if len(failed_downloads) > 5:
        print(f"  ... and {len(failed_downloads) - 5} more")

# Also save a list of systems for reference
with open('bio_digital_systems_list.txt', 'w', encoding='utf-8') as f:
    for idx, system in enumerate(data['data'][:72]):
        row = idx // COLS
        col = idx % COLS
        f.write(f"[{row},{col}] {system.get('name', 'Unknown')} ({system.get('year', 'N/A')})\n")

print(f"System list saved as 'bio_digital_systems_list.txt'")