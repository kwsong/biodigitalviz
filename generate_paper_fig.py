import json
import requests
from PIL import Image
from io import BytesIO
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from urllib.parse import urlparse, unquote
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
        # Special handling for Google URLs that might be search results
        if 'google.com' in img_name and 'url=' in img_name:
            # Try to extract the actual URL from Google redirect
            try:
                start = img_name.find('url=') + 4
                end = img_name.find('&', start)
                if end == -1:
                    actual_url = img_name[start:]
                else:
                    actual_url = img_name[start:end]
                return unquote(actual_url)
            except:
                pass
        return img_name
    else:
        # It's a filename, construct the URL
        return f"https://kwsong.github.io/biodigitalviz/images/{img_name}"

def download_image(url, max_retries=3):
    """Download image from URL with retry logic"""
    if not url:
        return None
    
    # Skip URLs that are clearly not direct image links
    skip_domains = ['google.com/url', 'google.com/search']
    if any(domain in url for domain in skip_domains):
        print(f"Skipping non-direct image URL: {url[:50]}...")
        return None
    
    for attempt in range(max_retries):
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
            
            response = requests.get(url, timeout=10, headers=headers, allow_redirects=True)
            
            if response.status_code == 200:
                # Check if content is actually an image
                content_type = response.headers.get('content-type', '').lower()
                if 'image' in content_type or url.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    img = Image.open(BytesIO(response.content))
                    # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    return img
                else:
                    print(f"Non-image content at {url[:50]}... (content-type: {content_type})")
                    return None
            else:
                print(f"HTTP {response.status_code} for {url[:50]}...")
                
        except Exception as e:
            if attempt == max_retries - 1:  # Only print on last attempt
                print(f"Failed to download {url[:50]}...: {str(e)[:50]}")
    
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
    from PIL import ImageDraw, ImageFont
    
    img = Image.new('RGB', (THUMB_SIZE, THUMB_SIZE), color='#e0e0e0')
    draw = ImageDraw.Draw(img)
    
    # Try to add text (will use default font if no specific font available)
    try:
        # Split text into lines if too long
        words = text.split()
        lines = []
        current_line = []
        for word in words:
            current_line.append(word)
            if len(' '.join(current_line)) > 12:
                if len(current_line) > 1:
                    current_line.pop()
                    lines.append(' '.join(current_line))
                    current_line = [word]
                else:
                    lines.append(word[:12])
                    current_line = []
        if current_line:
            lines.append(' '.join(current_line))
        
        # Draw text
        y_offset = THUMB_SIZE // 2 - (len(lines) * 10)
        for i, line in enumerate(lines[:3]):  # Max 3 lines
            draw.text((THUMB_SIZE//2, y_offset + i*20), line[:15], 
                     fill='#666666', anchor='mm')
    except:
        pass
    
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

print("Downloading thumbnails...")
for idx, system in enumerate(data['data'][:72]):  # Limit to 72 systems (6x12 grid)
    ax = axes_flat[idx]
    system_name = system.get('name', 'Unknown')
    
    if (idx + 1) % 12 == 0:  # Progress indicator
        print(f"Processing row {(idx + 1) // 12} of 6...")
    
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
        # Use placeholder with system name
        placeholder = create_placeholder(system_name)
        ax.imshow(placeholder)
        failed_downloads.append(f"{system_name} ({system.get('year', 'N/A')})")
    
    # Add subtle border
    rect = patches.Rectangle((0, 0), THUMB_SIZE-1, THUMB_SIZE-1, 
                            linewidth=0.5, edgecolor='#cccccc', facecolor='none')
    ax.add_patch(rect)
    
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
    print(f"\nSystems with missing images:")
    for system in failed_downloads:
        print(f"  - {system}")

# Also save a list of systems for reference
with open('bio_digital_systems_list.txt', 'w', encoding='utf-8') as f:
    f.write("Bio-Digital Systems Grid Reference\n")
    f.write("="*50 + "\n\n")
    for idx, system in enumerate(data['data'][:72]):
        row = idx // COLS
        col = idx % COLS
        status = "✓" if system.get('name', 'Unknown') not in [fd.split(' (')[0] for fd in failed_downloads] else "✗"
        f.write(f"[{row},{col}] {status} {system.get('name', 'Unknown')} ({system.get('year', 'N/A')})\n")

print(f"System list saved as 'bio_digital_systems_list.txt'")