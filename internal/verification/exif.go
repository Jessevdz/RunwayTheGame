package verification

import (
	"bytes"
	"encoding/binary"
	"strconv"
	"strings"
	"time"
)

// ExtractEXIFTimestamp returns the capture time embedded in JPEG, PNG, or WebP
// EXIF metadata. It does not consult any timestamp supplied by the client.
func ExtractEXIFTimestamp(image []byte) (time.Time, bool) {
	tiff := findExifTIFF(image)
	if len(tiff) == 0 {
		return time.Time{}, false
	}
	return parseTIFFTimestamp(tiff)
}

func findExifTIFF(image []byte) []byte {
	if len(image) >= 4 && bytes.Equal(image[:2], []byte{0xff, 0xd8}) {
		for offset := 2; offset+4 <= len(image); {
			if image[offset] != 0xff {
				offset++
				continue
			}
			for offset < len(image) && image[offset] == 0xff {
				offset++
			}
			if offset >= len(image) {
				break
			}
			marker := image[offset]
			offset++
			if marker == 0xda || marker == 0xd9 {
				break
			}
			if marker == 0x01 || marker >= 0xd0 && marker <= 0xd7 {
				continue
			}
			if offset+2 > len(image) {
				break
			}
			segmentLen := int(binary.BigEndian.Uint16(image[offset : offset+2]))
			if segmentLen < 2 || offset+segmentLen > len(image) {
				break
			}
			segment := image[offset+2 : offset+segmentLen]
			if marker == 0xe1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
				return segment[6:]
			}
			offset += segmentLen
		}
	}

	if len(image) >= 8 && bytes.Equal(image[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		for offset := 8; offset+12 <= len(image); {
			n := uint64(binary.BigEndian.Uint32(image[offset : offset+4]))
			end := uint64(offset) + 12 + n
			if end > uint64(len(image)) {
				break
			}
			if bytes.Equal(image[offset+4:offset+8], []byte("eXIf")) {
				return stripExifPrefix(image[offset+8 : offset+8+int(n)])
			}
			offset = int(end)
		}
	}

	if len(image) >= 12 && bytes.Equal(image[:4], []byte("RIFF")) && bytes.Equal(image[8:12], []byte("WEBP")) {
		for offset := 12; offset+8 <= len(image); {
			n := uint64(binary.LittleEndian.Uint32(image[offset+4 : offset+8]))
			end := uint64(offset) + 8 + n
			if end > uint64(len(image)) {
				break
			}
			if bytes.Equal(image[offset:offset+4], []byte("EXIF")) {
				return stripExifPrefix(image[offset+8 : offset+8+int(n)])
			}
			offset = int(end + (n & 1))
		}
	}
	return nil
}

func stripExifPrefix(value []byte) []byte {
	if bytes.HasPrefix(value, []byte("Exif\x00\x00")) {
		return value[6:]
	}
	return value
}

func parseTIFFTimestamp(tiff []byte) (time.Time, bool) {
	if len(tiff) < 8 {
		return time.Time{}, false
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return time.Time{}, false
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return time.Time{}, false
	}
	readIFD := func(offset uint32) (map[uint16]string, map[uint16]uint32) {
		texts := map[uint16]string{}
		longs := map[uint16]uint32{}
		if uint64(offset)+2 > uint64(len(tiff)) {
			return texts, longs
		}
		count := int(order.Uint16(tiff[offset : offset+2]))
		start := uint64(offset) + 2
		if start+uint64(count)*12+4 > uint64(len(tiff)) {
			return texts, longs
		}
		for i := 0; i < count; i++ {
			entry := tiff[int(start)+i*12 : int(start)+(i+1)*12]
			tag, typ := order.Uint16(entry[:2]), order.Uint16(entry[2:4])
			n := order.Uint32(entry[4:8])
			if typ != 2 || n == 0 {
				continue
			}
			var raw []byte
			if n <= 4 {
				raw = entry[8 : 8+n]
			} else {
				off := order.Uint32(entry[8:12])
				if uint64(off)+uint64(n) > uint64(len(tiff)) {
					continue
				}
				raw = tiff[off : off+n]
			}
			texts[tag] = strings.TrimRight(string(raw), "\x00 ")
		}
		for i := 0; i < count; i++ {
			entry := tiff[int(start)+i*12 : int(start)+(i+1)*12]
			tag, typ := order.Uint16(entry[:2]), order.Uint16(entry[2:4])
			if typ != 4 || order.Uint32(entry[4:8]) != 1 {
				continue
			}
			longs[tag] = order.Uint32(entry[8:12])
		}
		return texts, longs
	}

	root, rootLongs := readIFD(order.Uint32(tiff[4:8]))
	var exif map[uint16]string
	if offset := rootLongs[0x8769]; offset != 0 {
		exif, _ = readIFD(offset)
	}
	date := exif[0x9003]
	if date == "" {
		date = exif[0x9004]
	}
	if date == "" {
		date = root[0x0132]
	}
	parsed, err := time.Parse("2006:01:02 15:04:05", date)
	if err != nil {
		return time.Time{}, false
	}
	offset := exif[0x9011]
	if offset == "" {
		offset = exif[0x9012]
	}
	if len(offset) == 6 && (offset[0] == '+' || offset[0] == '-') && offset[3] == ':' {
		hours, hourErr := strconv.Atoi(offset[1:3])
		minutes, minErr := strconv.Atoi(offset[4:6])
		if hourErr == nil && minErr == nil && hours <= 23 && minutes <= 59 {
			seconds := (hours*60 + minutes) * 60
			if offset[0] == '-' {
				seconds = -seconds
			}
			parsed = time.Date(parsed.Year(), parsed.Month(), parsed.Day(), parsed.Hour(), parsed.Minute(), parsed.Second(), 0, time.FixedZone("EXIF", seconds))
		}
	}
	return parsed.UTC(), true
}
