import 'package:flutter/material.dart';

class IconOption {
  final String name;
  final IconData icon;

  const IconOption(this.name, this.icon);
}

class CinnostIcons {
  static const List<IconOption> icons = [
    IconOption('home', Icons.home),
    IconOption('kitchen', Icons.kitchen),
    IconOption('bathtub', Icons.bathtub),
    IconOption('bed', Icons.bed),
    IconOption('chair', Icons.chair),
    IconOption('door', Icons.door_front_door),
    IconOption('window', Icons.window),
    IconOption('light', Icons.lightbulb),
    IconOption('floor', Icons.apartment),
    IconOption('roof', Icons.roofing),
    IconOption('stairs', Icons.stairs),
    IconOption('garage', Icons.garage),
    IconOption('garden', Icons.nature),
    IconOption('grass', Icons.grass),
    IconOption('pool', Icons.pool),
    IconOption('balcony', Icons.balcony),
    IconOption('dining', Icons.dinner_dining),
    IconOption('shopping', Icons.shopping_cart),
    IconOption('clean', Icons.cleaning_services),
    IconOption('laundry', Icons.local_laundry_service),
    IconOption('wash', Icons.wash),
    IconOption('dishes', Icons.miscellaneous_services),
    IconOption('trash', Icons.delete),
    IconOption('recycle', Icons.recycling),
    IconOption('repair', Icons.home_repair_service),
    IconOption('tools', Icons.construction),
    IconOption('hammer', Icons.handyman),
    IconOption('wrench', Icons.plumbing),
    IconOption('paint', Icons.format_paint),
    IconOption('drill', Icons.precision_manufacturing),
    IconOption('key', Icons.key),
    IconOption('lock', Icons.lock),
    IconOption('unlock', Icons.lock_open),
    IconOption('security', Icons.security),
    IconOption('camera', Icons.videocam),
    IconOption('plants', Icons.eco),
    IconOption('water', Icons.water_drop),
    IconOption('sun', Icons.wb_sunny),
    IconOption('snow', Icons.ac_unit),
    IconOption('wind', Icons.air),
    IconOption('thermometer', Icons.thermostat),
    IconOption('humidity', Icons.opacity),
    IconOption('calendar', Icons.calendar_month),
    IconOption('clock', Icons.access_time),
    IconOption('star', Icons.star),
    IconOption('favorite', Icons.favorite),
    IconOption('person', Icons.person),
    IconOption('family', Icons.group),
    IconOption('check', Icons.check_circle),
    IconOption('done', Icons.done_all),
    IconOption('task', Icons.task_alt),
    IconOption('list', Icons.list),
  ];

  static IconData getIcon(String name) {
    try {
      return icons.firstWhere((icon) => icon.name == name).icon;
    } catch (e) {
      return Icons.home;
    }
  }
}

class CinnostColors {
  static const Map<String, String> colors = {
    'Zelená': '#4CAF50',
    'Modrá': '#2196F3',
    'Červená': '#F44336',
    'Oranžová': '#FF9800',
    'Fialová': '#9C27B0',
    'Ružová': '#E91E63',
    'Tyrkysová': '#00BCD4',
    'Žltá': '#FFEB3B',
    'Hnedá': '#795548',
    'Šedá': '#9E9E9E',
  };

  static Color hexToColor(String hex) {
    hex = hex.replaceFirst('#', '');
    if (hex.length == 6) {
      hex = 'FF' + hex;
    }
    return Color(int.parse(hex, radix: 16));
  }
}
