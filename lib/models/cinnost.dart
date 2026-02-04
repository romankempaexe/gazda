import 'package:cloud_firestore/cloud_firestore.dart';

enum Periodicity { none, weekly, monthly, annually }

class Cinnost {
  final String id;
  final String householdId;
  final String priestorId;
  final String name;
  final String description;
  final String assignedTo; // e-mail
  final String icon; // ikona nazov
  final String color; // hex farba
  final DateTime dueDate;
  final Periodicity periodicity;
  final int? repeatInterval; // počet týždňov/mesiacov
  final DateTime createdAt;
  final bool completed; // či je činnosť hotová

  Cinnost({
    required this.id,
    required this.householdId,
    required this.priestorId,
    required this.name,
    required this.description,
    required this.assignedTo,
    required this.icon,
    required this.color,
    required this.dueDate,
    required this.periodicity,
    this.repeatInterval,
    required this.createdAt,
    this.completed = false,
  });

  Map<String, dynamic> toMap() {
    return {
      'householdId': householdId,
      'priestorId': priestorId,
      'name': name,
      'description': description,
      'assignedTo': assignedTo,
      'icon': icon,
      'color': color,
      'dueDate': dueDate,
      'periodicity': periodicity.index,
      'repeatInterval': repeatInterval,
      'createdAt': createdAt,
      'completed': completed,
    };
  }

  factory Cinnost.fromMap(Map<String, dynamic> map, String id) {
    return Cinnost(
      id: id,
      householdId: map['householdId'] ?? '',
      priestorId: map['priestorId'] ?? '',
      name: map['name'] ?? '',
      description: map['description'] ?? '',
      assignedTo: map['assignedTo'] ?? '',
      icon: map['icon'] ?? 'home',
      color: map['color'] ?? '#4CAF50',
      dueDate: (map['dueDate'] as Timestamp).toDate(),
      periodicity: Periodicity.values[map['periodicity'] ?? 0],
      repeatInterval: map['repeatInterval'],
      createdAt: (map['createdAt'] as Timestamp).toDate(),
      completed: map['completed'] ?? false,
    );
  }

  Cinnost copyWith({
    String? id,
    String? householdId,
    String? priestorId,
    String? name,
    String? description,
    String? assignedTo,
    String? icon,
    String? color,
    DateTime? dueDate,
    Periodicity? periodicity,
    int? repeatInterval,
    DateTime? createdAt,
    bool? completed,
  }) {
    return Cinnost(
      id: id ?? this.id,
      householdId: householdId ?? this.householdId,
      priestorId: priestorId ?? this.priestorId,
      name: name ?? this.name,
      description: description ?? this.description,
      assignedTo: assignedTo ?? this.assignedTo,
      icon: icon ?? this.icon,
      color: color ?? this.color,
      dueDate: dueDate ?? this.dueDate,
      periodicity: periodicity ?? this.periodicity,
      repeatInterval: repeatInterval ?? this.repeatInterval,
      createdAt: createdAt ?? this.createdAt,
      completed: completed ?? this.completed,
    );
  }
}
