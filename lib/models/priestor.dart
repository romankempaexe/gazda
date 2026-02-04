import 'package:cloud_firestore/cloud_firestore.dart';

class Priestor {
  final String id;
  final String householdId;
  final String name;
  final DateTime createdAt;

  Priestor({
    required this.id,
    required this.householdId,
    required this.name,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {'householdId': householdId, 'name': name, 'createdAt': createdAt};
  }

  factory Priestor.fromMap(Map<String, dynamic> map, String id) {
    return Priestor(
      id: id,
      householdId: map['householdId'] ?? '',
      name: map['name'] ?? '',
      createdAt: (map['createdAt'] as Timestamp).toDate(),
    );
  }

  Priestor copyWith({
    String? id,
    String? householdId,
    String? name,
    DateTime? createdAt,
  }) {
    return Priestor(
      id: id ?? this.id,
      householdId: householdId ?? this.householdId,
      name: name ?? this.name,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
